import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { BibliographyEntryEntity, BibliographyCreator } from './bibliography-entry.entity';
import { ResourceEntity } from '../resource/resource.entity';

// Maps item types ↔ BibTeX entry types
const ITEM_TYPE_TO_BIBTEX: Record<string, string> = {
  journalArticle: 'article',
  book: 'book',
  bookSection: 'incollection',
  conferencePaper: 'inproceedings',
  thesis: 'phdthesis',
  report: 'techreport',
  webpage: 'misc',
  magazineArticle: 'article',
  newspaperArticle: 'article',
  encyclopediaArticle: 'incollection',
  document: 'misc',
  presentation: 'misc',
  dataset: 'misc',
  software: 'misc',
  blogPost: 'misc',
  forumPost: 'misc',
  misc: 'misc',
};

const BIBTEX_TO_ITEM_TYPE: Record<string, string> = {
  article: 'journalArticle',
  book: 'book',
  incollection: 'bookSection',
  inbook: 'bookSection',
  inproceedings: 'conferencePaper',
  conference: 'conferencePaper',
  phdthesis: 'thesis',
  mastersthesis: 'thesis',
  thesis: 'thesis',
  techreport: 'report',
  online: 'webpage',
  electronic: 'webpage',
  misc: 'misc',
};

@Injectable()
export class BibliographyService {
  constructor(
    @InjectRepository(BibliographyEntryEntity)
    private readonly repository: Repository<BibliographyEntryEntity>,
    @InjectRepository(ResourceEntity)
    private readonly resourceRepository: Repository<ResourceEntity>,
  ) { }

  async findOne(id: number): Promise<BibliographyEntryEntity | null> {
    return await this.repository.findOne({
      where: { id },
      relations: ['project', 'sourceResource'],
    });
  }

  async findAll(): Promise<BibliographyEntryEntity[]> {
    return await this.repository
      .createQueryBuilder('b')
      .leftJoinAndSelect('b.project', 'project')
      .leftJoinAndSelect('b.sourceResource', 'sourceResource')
      .orderBy('b.updated_at', 'DESC')
      .getMany();
  }

  async findGlobal(): Promise<BibliographyEntryEntity[]> {
    return await this.repository
      .createQueryBuilder('b')
      .leftJoinAndSelect('b.project', 'project')
      .leftJoinAndSelect('b.sourceResource', 'sourceResource')
      .where('b.projectId IS NULL')
      .orderBy('b.updated_at', 'DESC')
      .getMany();
  }

  async findByProject(projectId: number): Promise<BibliographyEntryEntity[]> {
    return await this.repository
      .createQueryBuilder('b')
      .leftJoinAndSelect('b.project', 'project')
      .leftJoinAndSelect('b.sourceResource', 'sourceResource')
      .where('b.projectId = :projectId OR b.projectId IS NULL', { projectId })
      .orderBy('b.updated_at', 'DESC')
      .getMany();
  }

  async create(data: Partial<BibliographyEntryEntity>): Promise<BibliographyEntryEntity> {
    const entry = this.repository.create(data);
    return await this.repository.save(entry);
  }

  async update(id: number, data: Partial<BibliographyEntryEntity>): Promise<BibliographyEntryEntity | null> {
    const entry = await this.repository.preload({ id, ...data });
    if (!entry) return null;
    return await this.repository.save(entry);
  }

  async assignProject(id: number, projectId: number): Promise<BibliographyEntryEntity | null> {
    await this.repository
      .createQueryBuilder()
      .update()
      .set({ project: { id: projectId } as any })
      .where('id = :id', { id })
      .execute();
    return await this.findOne(id);
  }

  async makeGlobal(id: number): Promise<BibliographyEntryEntity | null> {
    await this.repository
      .createQueryBuilder()
      .update()
      .set({ project: null })
      .where('id = :id', { id })
      .execute();
    return await this.findOne(id);
  }

  async remove(id: number): Promise<{ deleted: boolean }> {
    const entry = await this.repository.findOneBy({ id });
    if (!entry) return { deleted: false };
    await this.repository.remove(entry);
    return { deleted: true };
  }

  async importFromResource(resourceId: number, projectId?: number): Promise<BibliographyEntryEntity> {
    const existing = await this.repository.findOne({
      where: {
        sourceResource: { id: resourceId },
        project: projectId ? { id: projectId } : IsNull(),
      },
    });
    if (existing) return existing;

    const resource = await this.resourceRepository.findOne({
      where: { id: resourceId },
      relations: ['authors'],
    });
    if (!resource) throw new Error(`Resource ${resourceId} not found`);

    const creators: BibliographyCreator[] = (resource.authors ?? []).map((a) => {
      const parts = a.name.split(',');
      if (parts.length >= 2) {
        return { creatorType: 'author', lastName: parts[0].trim(), firstName: parts[1].trim() };
      }
      const words = a.name.trim().split(' ');
      if (words.length > 1) {
        return { creatorType: 'author', lastName: words[words.length - 1], firstName: words.slice(0, -1).join(' ') };
      }
      return { creatorType: 'author', lastName: a.name, firstName: '' };
    });

    const year = resource.publicationDate
      ? String(resource.publicationDate).slice(0, 4)
      : null;

    const citeKey = this.generateCiteKey(creators, year);

    const entry = this.repository.create({
      entryType: 'misc',
      citeKey,
      title: resource.title ?? resource.name,
      creators,
      year,
      url: resource.url ?? null,
      project: projectId ? ({ id: projectId } as any) : null,
      sourceResource: { id: resourceId } as any,
    });
    return await this.repository.save(entry);
  }

  async importBibTeX(
    bibtex: string,
    projectId?: number,
  ): Promise<BibliographyEntryEntity[]> {
    const parsed = this.parseBibTeX(bibtex);
    const entries = parsed.map((item) => {
      const creators: BibliographyCreator[] = [];
      if (item.fields.author) {
        item.fields.author.split(' and ').forEach((a) => {
          const trimmed = a.trim();
          const parts = trimmed.split(',');
          if (parts.length >= 2) {
            creators.push({ creatorType: 'author', lastName: parts[0].trim(), firstName: parts[1].trim() });
          } else {
            const words = trimmed.split(' ');
            creators.push({ creatorType: 'author', lastName: words[words.length - 1], firstName: words.slice(0, -1).join(' ') });
          }
        });
      }
      if (item.fields.editor) {
        item.fields.editor.split(' and ').forEach((a) => {
          const trimmed = a.trim();
          const parts = trimmed.split(',');
          if (parts.length >= 2) {
            creators.push({ creatorType: 'editor', lastName: parts[0].trim(), firstName: parts[1].trim() });
          } else {
            const words = trimmed.split(' ');
            creators.push({ creatorType: 'editor', lastName: words[words.length - 1], firstName: words.slice(0, -1).join(' ') });
          }
        });
      }

      const itemType = BIBTEX_TO_ITEM_TYPE[item.type] ?? 'misc';

      const isThesis = itemType === 'thesis';
      const isReport = itemType === 'report';

      const entry = this.repository.create({
        entryType: itemType,
        citeKey: item.key,
        title: item.fields.title ?? null,
        creators: creators.length > 0 ? creators : null,
        year: item.fields.year ?? null,
        abstract: item.fields.abstract ?? null,
        journal: item.fields.journal ?? null,
        journalAbbreviation: item.fields.journalabbreviation ?? item.fields.journalabbrev ?? null,
        booktitle: item.fields.booktitle ?? null,
        // 'number' in BibTeX means issue for articles, report-number for techreports
        number: (!isReport ? item.fields.number ?? item.fields.issue : null) ?? null,
        volume: item.fields.volume ?? null,
        pages: item.fields.pages ?? null,
        publisher: item.fields.publisher ?? null,
        place: item.fields.address ?? item.fields.location ?? null,
        edition: item.fields.edition ?? null,
        series: item.fields.series ?? null,
        seriesNumber: item.fields.seriesnumber ?? null,
        url: item.fields.url ?? null,
        doi: item.fields.doi ?? null,
        isbn: item.fields.isbn ?? null,
        issn: item.fields.issn ?? null,
        language: item.fields.language ?? null,
        note: item.fields.note ?? null,
        // thesis: school → university; report: institution stays in institution
        institution: isReport ? (item.fields.institution ?? null) : null,
        university: isThesis ? (item.fields.school ?? item.fields.institution ?? null) : null,
        thesisType: isThesis ? (item.fields.type ?? null) : null,
        reportNumber: isReport ? (item.fields.number ?? null) : null,
        reportType: isReport ? (item.fields.type ?? null) : null,
        conferenceName: item.fields.organization ?? null,
        extra: item.fields.annote ?? null,
        project: projectId ? ({ id: projectId } as any) : null,
      });
      return entry;
    });
    return await this.repository.save(entries);
  }

  async exportBibTeX(projectId?: number, ids?: number[]): Promise<string> {
    let query = this.repository
      .createQueryBuilder('b')
      .leftJoinAndSelect('b.project', 'project');

    if (ids && ids.length > 0) {
      query = query.where('b.id IN (:...ids)', { ids });
    } else if (projectId != null) {
      query = query.where('b.projectId = :projectId OR b.projectId IS NULL', { projectId });
    }

    const entries = await query.orderBy('b.cite_key', 'ASC').getMany();
    return entries.map((e) => this.entryToBibTeX(e)).join('\n\n');
  }

  // --- BibTeX parsing (simple, covers common cases) ---

  private parseBibTeX(bibtex: string): Array<{ type: string; key: string; fields: Record<string, string> }> {
    const results: Array<{ type: string; key: string; fields: Record<string, string> }> = [];
    const entryRegex = /@(\w+)\s*\{([^,]+),([^@]*)\}/gs;
    let match: RegExpExecArray | null;

    while ((match = entryRegex.exec(bibtex)) !== null) {
      const type = match[1].toLowerCase();
      if (type === 'comment' || type === 'string' || type === 'preamble') continue;

      const key = match[2].trim();
      const body = match[3];
      const fields: Record<string, string> = {};

      const fieldRegex = /(\w+)\s*=\s*(?:\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}|"([^"]*)"|(\d+))/g;
      let fm: RegExpExecArray | null;
      while ((fm = fieldRegex.exec(body)) !== null) {
        const fieldName = fm[1].toLowerCase();
        const value = (fm[2] ?? fm[3] ?? fm[4] ?? '').trim();
        fields[fieldName] = value;
      }

      results.push({ type, key, fields });
    }

    return results;
  }

  private entryToBibTeX(entry: BibliographyEntryEntity): string {
    const bibType = ITEM_TYPE_TO_BIBTEX[entry.entryType] ?? entry.entryType;
    const key = entry.citeKey ?? `entry${entry.id}`;
    const lines: string[] = [`@${bibType}{${key},`];

    const addField = (name: string, value: string | null | undefined) => {
      if (value != null && value !== '') lines.push(`  ${name} = {${value}},`);
    };

    addField('title', entry.title);

    // Authors (creatorType = 'author')
    const authors = (entry.creators ?? []).filter((c) => c.creatorType === 'author');
    if (authors.length > 0) {
      const authorStr = authors.map((c) => {
        if (c.name) return c.name;
        if (c.firstName) return `${c.lastName}, ${c.firstName}`;
        return c.lastName ?? '';
      }).join(' and ');
      addField('author', authorStr);
    }

    // Editors
    const editors = (entry.creators ?? []).filter((c) => c.creatorType === 'editor');
    if (editors.length > 0) {
      const editorStr = editors.map((c) => {
        if (c.name) return c.name;
        if (c.firstName) return `${c.lastName}, ${c.firstName}`;
        return c.lastName ?? '';
      }).join(' and ');
      addField('editor', editorStr);
    }

    addField('year', entry.year);
    addField('journal', entry.journal);
    addField('journalabbrev', entry.journalAbbreviation);
    addField('booktitle', entry.booktitle);
    addField('volume', entry.volume);
    // For reports, 'number' is the report number; for others it's volume issue
    addField('number', entry.reportNumber ?? entry.number);
    addField('pages', entry.pages);
    addField('publisher', entry.publisher);
    addField('address', entry.place);
    addField('edition', entry.edition);
    addField('series', entry.series);
    addField('url', entry.url);
    addField('doi', entry.doi);
    addField('isbn', entry.isbn);
    addField('issn', entry.issn);
    addField('abstract', entry.abstract);
    addField('language', entry.language);
    addField('note', entry.note);
    // type-specific fields — avoid wrong field duplication across entry types
    if (entry.entryType === 'thesis') {
      addField('school', entry.university ?? entry.institution);
      addField('type', entry.thesisType);
    } else if (entry.entryType === 'report') {
      addField('institution', entry.institution);
      addField('type', entry.reportType);
    } else if (entry.entryType === 'conferencePaper') {
      addField('organization', entry.conferenceName);
    }

    if (entry.extraFields) {
      for (const [k, v] of Object.entries(entry.extraFields)) {
        addField(k, v);
      }
    }

    lines.push('}');
    return lines.join('\n');
  }

  private generateCiteKey(creators: BibliographyCreator[], year: string | null): string {
    const first = creators.find((c) => c.creatorType === 'author') ?? creators[0];
    const surname = first?.lastName ?? first?.name ?? 'unknown';
    const normalized = surname.toLowerCase().replace(/[^a-z]/g, '');
    return `${normalized}${year ?? 'nd'}`;
  }
}

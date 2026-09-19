import { Injectable, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DocService } from '../doc/doc.service';
import { ResourceService } from '../resource/resource.service';
import { CanvasService } from '../canvas/canvas.service';
import { NoteService } from '../note/note.service';
import { CalendarEventService } from '../calendar-event/calendar-event.service';
import { KnowledgeEntryService } from '../knowledge-base/knowledge-entry.service';
import { EntityService } from '../entity/entity.service';
import { DatasetService } from '../dataset/dataset.service';
import { ProjectService } from '../project/project.service';
import { TimelineService } from '../timeline/timeline.service';
import { BibliographyService } from '../bibliography/bibliography.service';
import * as cheerio from 'cheerio';
import { SearchResultDto } from './dto/search-result.dto';
import { PageEntityMatch } from './dto/page-entities.dto';
import { PageBlockResult } from './dto/page-blocks.dto';
import {
  bibliographyCitationForms,
  entityTermsOf,
  knowledgeTermsOf,
  matchDateInText,
  matchTaggedTermsInText,
  matchTermsInText,
} from './page-match.util';
import {
  PageKnowledgeMatch,
  PageTimelineMatch,
  PageBibliographyMatch,
} from './dto/page-matches.dto';

type Highlight = (text: string, chars?: number) => string;

interface CollectionMapperConfig {
  collection: SearchResultDto['collection'];
  id: (row: any) => number;
  name: (row: any) => string;
  /** Overrides the default relevance score (`parseFloat(row.score) || 0`). */
  score?: (row: any) => number;
  highlights: (row: any, highlight: Highlight) => Partial<SearchResultDto>;
}

interface SearchCollection {
  search: (searchTerm: string, projectId?: number) => Promise<any[]>;
  mapper: CollectionMapperConfig;
  /** Always-on collections map their rows unguarded. */
  required?: boolean;
}

const COLLECTION_MAPPERS: Record<string, CollectionMapperConfig> = {
  // Projects surface through the docs collection and carry a fixed relevance
  // since project search returns no score.
  projects: {
    collection: 'docs',
    id: (r) => r.id,
    name: (r) => r.name,
    score: () => 0.6,
    highlights: (r, highlight) => ({
      highlightedName: highlight(r.name || ''),
    }),
  },
  docs: {
    collection: 'docs',
    id: (r) => r.d_id,
    name: (r) => r.d_name,
    highlights: (r, highlight) => ({
      highlightedName: highlight(r.d_name, 50),
      highlightedContent: highlight(r.d_content, 100),
    }),
  },
  resources: {
    collection: 'resources',
    id: (r) => r.r_id,
    name: (r) => r.r_name,
    highlights: (r, highlight) => ({
      highlightedTitle: highlight(r.r_title, 50),
      highlightedName: highlight(r.r_name, 50),
      highlightedContent: highlight(r.r_content, 100)
        || highlight(r.r_translated_content, 100),
    }),
  },
  canvases: {
    collection: 'canvases',
    id: (r) => r.c_id,
    name: (r) => r.c_name,
    highlights: (r, highlight) => ({
      highlightedName: highlight(r.c_name, 50),
      highlightedContent: highlight(r.c_content, 100),
    }),
  },
  notes: {
    collection: 'notes',
    id: (r) => r.n_id,
    name: (r) => r.n_title || 'Untitled note',
    highlights: (r, highlight) => ({
      highlightedName: highlight(r.n_title, 50),
      highlightedContent: highlight(r.n_content, 100),
    }),
  },
  events: {
    collection: 'events',
    id: (r) => r.e_id,
    name: (r) => r.e_title || 'Untitled event',
    highlights: (r, highlight) => ({
      highlightedName: highlight(r.e_title, 50),
      highlightedContent: highlight(r.e_description, 100),
    }),
  },
  knowledge: {
    collection: 'knowledge',
    id: (r) => r.k_id,
    name: (r) => r.k_title || 'Untitled entry',
    highlights: (r, highlight) => ({
      highlightedName: highlight(r.k_title, 50),
      highlightedContent: highlight(r.k_content || r.k_summary, 100),
    }),
  },
  entities: {
    collection: 'entities',
    id: (r) => r.e_id,
    name: (r) => r.e_name,
    highlights: (r, highlight) => ({
      highlightedName: highlight(r.e_name, 50),
      highlightedContent: highlight(r.e_description, 100),
    }),
  },
  datasets: {
    collection: 'datasets',
    id: (r) => r.d_id,
    name: (r) => r.d_name,
    highlights: (r, highlight) => ({
      highlightedName: highlight(r.d_name, 50),
      highlightedContent: highlight(r.d_description, 100),
    }),
  },
};

@Injectable()
export class SearchService {
  private readonly projectCollections: SearchCollection[];
  private readonly globalCollections: SearchCollection[];

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly docService: DocService,
    private readonly resourceService: ResourceService,
    @Optional() private readonly canvasService?: CanvasService,
    @Optional() private readonly noteService?: NoteService,
    @Optional() private readonly calendarEventService?: CalendarEventService,
    @Optional() private readonly knowledgeEntryService?: KnowledgeEntryService,
    @Optional() private readonly entityService?: EntityService,
    @Optional() private readonly datasetService?: DatasetService,
    @Optional() private readonly projectService?: ProjectService,
    @Optional() private readonly timelineService?: TimelineService,
    @Optional() private readonly bibliographyService?: BibliographyService,
  ) {
    const docs: SearchCollection = {
      required: true,
      mapper: COLLECTION_MAPPERS.docs,
      search: (term, projectId) => this.docService.globalSearch(term, projectId),
    };
    const resources: SearchCollection = {
      required: true,
      mapper: COLLECTION_MAPPERS.resources,
      search: (term, projectId) => this.resourceService.globalSearch(term, projectId),
    };
    const projects: SearchCollection = this.projectService && {
      mapper: COLLECTION_MAPPERS.projects,
      search: (term) => this.searchProjects(term),
    };
    const canvases: SearchCollection = this.canvasService && {
      mapper: COLLECTION_MAPPERS.canvases,
      search: (term, projectId) => this.canvasService.globalSearch(term, projectId),
    };
    const notes: SearchCollection = this.noteService && {
      mapper: COLLECTION_MAPPERS.notes,
      search: (term, projectId) => this.noteService.globalSearch(term, projectId),
    };
    const events: SearchCollection = this.calendarEventService && {
      mapper: COLLECTION_MAPPERS.events,
      search: (term, projectId) => this.calendarEventService.globalSearch(term, projectId),
    };
    const knowledge: SearchCollection = this.knowledgeEntryService && {
      mapper: COLLECTION_MAPPERS.knowledge,
      search: (term) => this.knowledgeEntryService.globalSearch(term),
    };
    const entities: SearchCollection = this.entityService && {
      mapper: COLLECTION_MAPPERS.entities,
      search: (term, projectId) => this.entityService.globalSearch(term, projectId),
    };
    const datasets: SearchCollection = this.datasetService && {
      mapper: COLLECTION_MAPPERS.datasets,
      search: (term, projectId) => this.datasetService.globalSearch(term, projectId),
    };

    this.projectCollections = [docs, resources, canvases, notes, events, entities, datasets].filter(Boolean);
    // Global search includes every available collection used by the UI and assistant tool.
    this.globalCollections = [docs, resources, projects, notes, canvases, events, knowledge, entities, datasets].filter(Boolean);
  }

  private highlightTextInHtml(
    fullContent: string,
    searchTerm: string,
    charsToExamine: number = 100,
  ): string {
    if (!fullContent || !searchTerm) {
      return fullContent;
    }

    const $ = cheerio.load(fullContent);
    const textContent = $.text();

    const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    const matches = [...textContent.matchAll(regex)];

    if (matches.length === 0) {
      return (
        textContent.substring(0, charsToExamine) +
        (textContent.length > charsToExamine ? '...' : '')
      );
    }

    const firstMatch = matches[0];
    const matchIndex = firstMatch.index;
    const matchedText = firstMatch[1];

    const startIndex = Math.max(0, matchIndex - charsToExamine / 2);
    const endIndex = Math.min(
      textContent.length,
      matchIndex + matchedText.length + charsToExamine / 2,
    );

    let fragment = textContent.substring(startIndex, endIndex);

    fragment = fragment.replace(regex, `<strong>$1</strong>`);

    if (startIndex > 0) fragment = '...' + fragment;
    if (endIndex < textContent.length) fragment = fragment + '...';

    return fragment;
  }

  async globalSearch(searchTerm: string, projectId?: number): Promise<SearchResultDto[]> {
    if (projectId) {
      return this.searchInProject(searchTerm, projectId);
    }
    return this.searchGlobal(searchTerm);
  }

  private async searchInProject(searchTerm: string, projectId: number): Promise<SearchResultDto[]> {
    return this.searchCollections(this.projectCollections, searchTerm, projectId);
  }

  private async searchGlobal(searchTerm: string): Promise<SearchResultDto[]> {
    return this.searchCollections(this.globalCollections, searchTerm);
  }

  private async searchCollections(
    collections: SearchCollection[],
    searchTerm: string,
    projectId?: number,
  ): Promise<SearchResultDto[]> {
    const resolved = await Promise.all(collections.map((c) => c.search(searchTerm, projectId)));

    const results = collections.flatMap((c, i) => {
      const rows = resolved[i];
      if (!rows && !c.required) return [];
      return this.mapCollection(rows, searchTerm, c.mapper);
    });

    results.sort((a, b) => b.score - a.score);
    return results;
  }

  /** Project search returns ProjectEntity[]; wrap to the raw shape the
   * projects mapper expects (id/name/description). */
  private async searchProjects(searchTerm: string): Promise<any[]> {
    if (!this.projectService || !searchTerm?.trim()) return [];
    const projects = await this.projectService.search(searchTerm);
    return projects.map((p) => ({ id: p.id, name: p.name, description: p.description }));
  }

  private mapCollection(raw: any[], searchTerm: string, config: CollectionMapperConfig): SearchResultDto[] {
    const highlight: Highlight = (text, chars) => this.highlightTextInHtml(text, searchTerm, chars);
    return raw.map((r) => ({
      id: config.id(r),
      name: config.name(r),
      score: config.score ? config.score(r) : parseFloat(r.score) || 0,
      collection: config.collection,
      ...config.highlights(r, highlight),
    }));
  }

  async matchEntitiesInText(text: string, projectId?: number): Promise<PageEntityMatch[]> {
    if (!text || text.trim().length === 0) {
      return [];
    }

    const normalizedText = text.slice(0, 10000);

    // Fetch all entities (scoped to project if provided, plus globals)
    let query = `
      SELECT e.id, e.name, e.description, e.aliases, e.translations,
             et.name as entity_type_name
      FROM entities e
      LEFT JOIN entity_types et ON et.id = e.entity_type_id
    `;
    const params: any[] = [];

    if (projectId) {
      query += `
        WHERE (
          EXISTS (SELECT 1 FROM entity_projects ep WHERE ep.entity_id = e.id AND ep.project_id = $1)
          OR e.global = true
        )
      `;
      params.push(projectId);
    }

    let entities: any[];
    try {
      entities = await this.dataSource.query(query, params);
    } catch {
      return [];
    }

    const matches: PageEntityMatch[] = [];
    const seenIds = new Set<number>();

    for (const entity of entities) {
      const terms = entityTermsOf(entity);
      const matchedTerms = matchTermsInText(normalizedText, terms);

      if (matchedTerms.length > 0 && !seenIds.has(entity.id)) {
        seenIds.add(entity.id);
        matches.push({
          id: entity.id,
          name: entity.name,
          type: entity.entity_type_name || 'Unknown',
          description: entity.description,
          matchedTerms: [...new Set(matchedTerms)],
        });
      }
    }

    return matches;
  }

  async matchKnowledgeInText(text: string): Promise<PageKnowledgeMatch[]> {
    const normalized = (text ?? '').slice(0, 10000);
    if (!normalized.trim() || !this.knowledgeEntryService) {
      return [];
    }

    let entries: any[];
    try {
      entries = await this.knowledgeEntryService.findAll();
    } catch {
      return [];
    }

    const matches: PageKnowledgeMatch[] = [];
    for (const entry of entries) {
      const matchedTerms = matchTermsInText(normalized, knowledgeTermsOf(entry));
      if (matchedTerms.length > 0) {
        matches.push({
          id: entry.id,
          title: entry.title,
          summary: entry.summary ?? null,
          matchedTerms: [...new Set(matchedTerms)],
        });
      }
    }
    return matches;
  }

  async matchTimelineInText(
    text: string,
    projectId?: number,
  ): Promise<PageTimelineMatch[]> {
    const normalized = (text ?? '').slice(0, 10000);
    if (!normalized.trim() || !projectId || !this.timelineService) {
      return [];
    }

    let timelines: any[];
    try {
      timelines = await this.timelineService.findByProject(projectId);
    } catch {
      return [];
    }

    const matches: PageTimelineMatch[] = [];
    for (const timeline of timelines) {
      const events = Array.isArray(timeline.timelineData)
        ? timeline.timelineData
        : [];
      for (const event of events) {
        // La fecha de inicio manda; si no aparece, se prueba con la de fin,
        // que es como se escribe un periodo en prosa.
        const found =
          matchDateInText(normalized, event?.date) ??
          matchDateInText(normalized, event?.endDate);
        if (!found) {
          continue;
        }
        matches.push({
          timelineId: timeline.id,
          timelineName: timeline.name,
          eventId: event.id ?? null,
          title: event.title ?? '',
          date: event.date,
          endDate: event.endDate ?? null,
          description: event.description ?? null,
          matchedTerm: found.term,
          precision: found.precision,
        });
      }
    }
    return matches;
  }

  async matchBibliographyInText(
    text: string,
    projectId?: number,
  ): Promise<PageBibliographyMatch[]> {
    const normalized = (text ?? '').slice(0, 10000);
    if (!normalized.trim() || !this.bibliographyService) {
      return [];
    }

    let entries: any[];
    try {
      entries = projectId
        ? await this.bibliographyService.findByProject(projectId)
        : await this.bibliographyService.findAll();
    } catch {
      return [];
    }

    const matches: PageBibliographyMatch[] = [];
    for (const entry of entries) {
      const matched = matchTaggedTermsInText(
        normalized,
        bibliographyCitationForms(entry),
      );
      if (matched.length > 0) {
        matches.push({
          id: entry.id,
          citeKey: entry.citeKey ?? null,
          title: entry.title ?? null,
          creators: entry.creators ?? null,
          year: entry.year ?? null,
          journal: entry.journal ?? null,
          publisher: entry.publisher ?? null,
          doi: entry.doi ?? null,
          url: entry.url ?? null,
          matchedTerms: [...new Set(matched.map((m) => m.term))],
          matchKinds: [...new Set(matched.map((m) => m.kind))],
        });
      }
    }
    return matches;
  }

  /**
   * Extract meaningful keywords from a block of text.
   * Filters out common stopwords and short words, returns the most distinctive terms.
   */
  private extractKeywords(text: string, maxKeywords = 5): string[] {
    const stopwords = new Set([
      // Spanish
      'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al',
      'en', 'con', 'por', 'para', 'que', 'es', 'son', 'fue', 'ser', 'está',
      'como', 'más', 'pero', 'sus', 'este', 'esta', 'estos', 'estas', 'ese',
      'esa', 'esos', 'esas', 'hay', 'ya', 'también', 'muy', 'entre', 'sobre',
      'sin', 'hasta', 'desde', 'donde', 'todo', 'todos', 'toda', 'todas',
      'otro', 'otra', 'otros', 'otras', 'cada', 'según', 'han', 'tiene',
      'puede', 'cuando', 'cual', 'será', 'sido', 'siendo', 'había', 'tiene',
      'nos', 'les', 'así', 'quien', 'parte', 'después', 'bien', 'solo',
      'hace', 'hoy', 'ahora', 'aquí', 'durante', 'siempre', 'mismo', 'misma',
      // English
      'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
      'her', 'was', 'one', 'our', 'out', 'has', 'have', 'been', 'will',
      'with', 'this', 'that', 'from', 'they', 'were', 'what', 'when', 'your',
      'said', 'each', 'which', 'their', 'time', 'will', 'way', 'about',
      'many', 'then', 'them', 'some', 'would', 'make', 'like', 'into',
      'could', 'other', 'than', 'its', 'also', 'after', 'new', 'just',
      'more', 'these', 'two', 'may', 'first', 'being', 'any', 'through',
      'most', 'how', 'where', 'between', 'does', 'did', 'get',
    ]);

    // Split text into words, filter and score them
    const words = text
      .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3 && !stopwords.has(w.toLowerCase()))
      .map(w => w.replace(/^['-]+|['-]+$/g, ''));

    // Count frequency - more frequent = more important
    const freq = new Map<string, number>();
    for (const w of words) {
      const lower = w.toLowerCase();
      freq.set(lower, (freq.get(lower) || 0) + 1);
    }

    // Prefer longer, less common words (likely proper nouns, technical terms)
    // Also prefer capitalized words (proper nouns)
    const scored = [...freq.entries()].map(([word, count]) => {
      let score = count;
      if (word.length >= 6) score += 2;
      if (word.length >= 10) score += 2;
      // Check if any occurrence was capitalized (proper noun)
      const original = words.find(w => w.toLowerCase() === word);
      if (original && original[0] === original[0].toUpperCase() && original[0] !== original[0].toLowerCase()) {
        score += 3;
      }
      return { word, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxKeywords).map(s => s.word);
  }

  async searchBlocks(blocks: { blockId: string; text: string }[], projectId?: number): Promise<PageBlockResult[]> {
    if (!blocks || blocks.length === 0) return [];

    // Limit to 20 blocks to avoid overloading
    const limitedBlocks = blocks.slice(0, 20);

    const results = await Promise.all(
      limitedBlocks.map(async (block) => {
        const text = block.text.slice(0, 500).trim();
        if (!text || text.length < 20) {
          return { blockId: block.blockId, results: [] };
        }

        // Extract keywords instead of using full sentences
        const keywords = this.extractKeywords(text, 4);
        if (keywords.length === 0) {
          return { blockId: block.blockId, results: [] };
        }

        // Search each keyword individually and merge results
        const allResults: SearchResultDto[] = [];
        const seenIds = new Set<string>();
        const MIN_SCORE = 0.3;

        for (const keyword of keywords) {
          try {
            const searchResults = await this.globalSearch(keyword, projectId);
            for (const r of searchResults) {
              if (r.score < MIN_SCORE) continue;
              const key = `${r.collection}-${r.id}`;
              if (!seenIds.has(key)) {
                seenIds.add(key);
                allResults.push(r);
              }
            }
          } catch {
            // Skip failed searches
          }
        }

        // Sort by score and take top 3
        allResults.sort((a, b) => b.score - a.score);
        return {
          blockId: block.blockId,
          results: allResults.slice(0, 3),
        };
      })
    );

    // Filter out blocks with no results
    return results.filter(r => r.results.length > 0);
  }
}

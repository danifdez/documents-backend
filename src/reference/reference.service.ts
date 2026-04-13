import { Injectable } from '@nestjs/common';
import { ResourceService } from '../resource/resource.service';
import { MarkService } from '../mark/mark.service';
import { DocService } from '../doc/doc.service';
import { KnowledgeEntryService } from '../knowledge-base/knowledge-entry.service';
import { BibliographyService } from '../bibliography/bibliography.service';

@Injectable()
export class ReferenceService {
  constructor(
    private readonly resourceService: ResourceService,
    private readonly markService: MarkService,
    private readonly docService: DocService,
    private readonly knowledgeEntryService: KnowledgeEntryService,
    private readonly bibliographyService: BibliographyService,
  ) { }

  async search(query: string, types?: string[]): Promise<any[]> {
    if (!query || !query.trim()) return [];

    const allTypes = !types || types.length === 0;
    const include = (t: string) => allTypes || types!.includes(t);

    const promises: Promise<any[]>[] = [];

    if (include('resource') || include('mark')) {
      promises.push(this.searchResourcesAndMarks(query));
    }
    if (include('doc')) {
      promises.push(this.searchDocs(query));
    }
    if (include('bibliography')) {
      promises.push(this.searchBibliography(query));
    }
    if (include('knowledge')) {
      promises.push(this.searchKnowledge(query));
    }

    const results = await Promise.all(promises);
    return results.flat();
  }

  private async searchResourcesAndMarks(query: string): Promise<any[]> {
    const [resources, marks] = await Promise.all([
      this.resourceService.search(query),
      this.markService.search(query),
    ]);

    return [
      ...resources.map((r: any) => ({
        id: String(r.id),
        type: 'resource' as const,
        name: r.name,
      })),
      ...marks.map((m: any) => ({
        id: String(m.id),
        type: 'mark' as const,
        name: m.content?.slice(0, 60) || 'Mark',
        content: m.content,
      })),
    ].filter(item => item.id != null);
  }

  private async searchDocs(query: string): Promise<any[]> {
    const docs = await this.docService.globalSearch(query);
    return docs.map((d: any) => ({
      id: String(d.id),
      type: 'doc' as const,
      name: d.name,
    }));
  }

  private async searchBibliography(query: string): Promise<any[]> {
    const entries = await this.bibliographyService.search(query);
    return entries.map((e: any) => ({
      id: String(e.id),
      type: 'bibliography' as const,
      name: e.title || e.citeKey || 'Untitled',
      meta: {
        year: e.year,
        creators: e.creators,
        journal: e.journal,
        publisher: e.publisher,
        entryType: e.entryType,
      },
    }));
  }

  private async searchKnowledge(query: string): Promise<any[]> {
    const entries = await this.knowledgeEntryService.search(query);
    return entries.map((e: any) => ({
      id: String(e.id),
      type: 'knowledge' as const,
      name: e.title,
      content: e.summary,
    }));
  }
}

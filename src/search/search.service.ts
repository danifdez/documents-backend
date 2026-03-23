import { Injectable } from '@nestjs/common';
import { DocService } from 'src/doc/doc.service';
import { ResourceService } from 'src/resource/resource.service';
import { CanvasService } from 'src/canvas/canvas.service';
import { NoteService } from 'src/note/note.service';
import { CalendarEventService } from 'src/calendar-event/calendar-event.service';
import { KnowledgeEntryService } from 'src/knowledge-base/knowledge-entry.service';
import { EntityService } from 'src/entity/entity.service';
import { DatasetService } from 'src/dataset/dataset.service';
import * as cheerio from 'cheerio';
import { SearchResultDto } from './dto/search-result.dto';

@Injectable()
export class SearchService {
  constructor(
    private readonly docService: DocService,
    private readonly resourceService: ResourceService,
    private readonly canvasService: CanvasService,
    private readonly noteService: NoteService,
    private readonly calendarEventService: CalendarEventService,
    private readonly knowledgeEntryService: KnowledgeEntryService,
    private readonly entityService: EntityService,
    private readonly datasetService: DatasetService,
  ) { }

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

    const regex = new RegExp(`(${searchTerm})`, 'gi');
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
    const [docs, resources, canvases, notes, events, entities, datasets] = await Promise.all([
      this.docService.globalSearch(searchTerm, projectId),
      this.resourceService.globalSearch(searchTerm, projectId),
      this.canvasService.globalSearch(searchTerm, projectId),
      this.noteService.globalSearch(searchTerm, projectId),
      this.calendarEventService.globalSearch(searchTerm, projectId),
      this.entityService.globalSearch(searchTerm, projectId),
      this.datasetService.globalSearch(searchTerm, projectId),
    ]);

    const results: SearchResultDto[] = [
      ...this.mapDocs(docs, searchTerm),
      ...this.mapResources(resources, searchTerm),
      ...this.mapCanvases(canvases, searchTerm),
      ...this.mapNotes(notes, searchTerm),
      ...this.mapEvents(events, searchTerm),
      ...this.mapEntities(entities, searchTerm),
      ...this.mapDatasets(datasets, searchTerm),
    ];

    results.sort((a, b) => b.score - a.score);
    return results;
  }

  private async searchGlobal(searchTerm: string): Promise<SearchResultDto[]> {
    const [notes, events, knowledge, entities, datasets] = await Promise.all([
      this.noteService.globalSearch(searchTerm),
      this.calendarEventService.globalSearch(searchTerm),
      this.knowledgeEntryService.globalSearch(searchTerm),
      this.entityService.globalSearch(searchTerm),
      this.datasetService.globalSearch(searchTerm),
    ]);

    const results: SearchResultDto[] = [
      ...this.mapNotes(notes, searchTerm),
      ...this.mapEvents(events, searchTerm),
      ...this.mapKnowledge(knowledge, searchTerm),
      ...this.mapEntities(entities, searchTerm),
      ...this.mapDatasets(datasets, searchTerm),
    ];

    results.sort((a, b) => b.score - a.score);
    return results;
  }

  private mapDocs(raw: any[], searchTerm: string): SearchResultDto[] {
    return raw.map((r) => ({
      id: r.d_id,
      name: r.d_name,
      score: parseFloat(r.score) || 0,
      collection: 'docs' as const,
      highlightedName: this.highlightTextInHtml(r.d_name, searchTerm, 50),
      highlightedContent: this.highlightTextInHtml(r.d_content, searchTerm, 100),
    }));
  }

  private mapResources(raw: any[], searchTerm: string): SearchResultDto[] {
    return raw.map((r) => ({
      id: r.r_id,
      name: r.r_name,
      score: parseFloat(r.score) || 0,
      collection: 'resources' as const,
      highlightedTitle: this.highlightTextInHtml(r.r_title, searchTerm, 50),
      highlightedName: this.highlightTextInHtml(r.r_name, searchTerm, 50),
      highlightedContent: this.highlightTextInHtml(r.r_content, searchTerm, 100)
        || this.highlightTextInHtml(r.r_translated_content, searchTerm, 100),
    }));
  }

  private mapCanvases(raw: any[], searchTerm: string): SearchResultDto[] {
    return raw.map((r) => ({
      id: r.c_id,
      name: r.c_name,
      score: parseFloat(r.score) || 0,
      collection: 'canvases' as const,
      highlightedName: this.highlightTextInHtml(r.c_name, searchTerm, 50),
      highlightedContent: this.highlightTextInHtml(r.c_content, searchTerm, 100),
    }));
  }

  private mapNotes(raw: any[], searchTerm: string): SearchResultDto[] {
    return raw.map((r) => ({
      id: r.n_id,
      name: r.n_title || 'Untitled note',
      score: parseFloat(r.score) || 0,
      collection: 'notes' as const,
      highlightedName: this.highlightTextInHtml(r.n_title, searchTerm, 50),
      highlightedContent: this.highlightTextInHtml(r.n_content, searchTerm, 100),
    }));
  }

  private mapEvents(raw: any[], searchTerm: string): SearchResultDto[] {
    return raw.map((r) => ({
      id: r.e_id,
      name: r.e_title || 'Untitled event',
      score: parseFloat(r.score) || 0,
      collection: 'events' as const,
      highlightedName: this.highlightTextInHtml(r.e_title, searchTerm, 50),
      highlightedContent: this.highlightTextInHtml(r.e_description, searchTerm, 100),
    }));
  }

  private mapKnowledge(raw: any[], searchTerm: string): SearchResultDto[] {
    return raw.map((r) => ({
      id: r.k_id,
      name: r.k_title || 'Untitled entry',
      score: parseFloat(r.score) || 0,
      collection: 'knowledge' as const,
      highlightedName: this.highlightTextInHtml(r.k_title, searchTerm, 50),
      highlightedContent: this.highlightTextInHtml(r.k_content || r.k_summary, searchTerm, 100),
    }));
  }

  private mapEntities(raw: any[], searchTerm: string): SearchResultDto[] {
    return raw.map((r) => ({
      id: r.e_id,
      name: r.e_name,
      score: parseFloat(r.score) || 0,
      collection: 'entities' as const,
      highlightedName: this.highlightTextInHtml(r.e_name, searchTerm, 50),
      highlightedContent: this.highlightTextInHtml(r.e_description, searchTerm, 100),
    }));
  }

  private mapDatasets(raw: any[], searchTerm: string): SearchResultDto[] {
    return raw.map((r) => ({
      id: r.d_id,
      name: r.d_name,
      score: parseFloat(r.score) || 0,
      collection: 'datasets' as const,
      highlightedName: this.highlightTextInHtml(r.d_name, searchTerm, 50),
      highlightedContent: this.highlightTextInHtml(r.d_description, searchTerm, 100),
    }));
  }
}

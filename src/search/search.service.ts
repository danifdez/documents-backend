import { Injectable, Optional } from '@nestjs/common';
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
    @Optional() private readonly canvasService?: CanvasService,
    @Optional() private readonly noteService?: NoteService,
    @Optional() private readonly calendarEventService?: CalendarEventService,
    @Optional() private readonly knowledgeEntryService?: KnowledgeEntryService,
    @Optional() private readonly entityService?: EntityService,
    @Optional() private readonly datasetService?: DatasetService,
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
    const promises: Promise<any[]>[] = [
      this.docService.globalSearch(searchTerm, projectId),
      this.resourceService.globalSearch(searchTerm, projectId),
    ];
    const keys = ['docs', 'resources'];

    if (this.canvasService) { promises.push(this.canvasService.globalSearch(searchTerm, projectId)); keys.push('canvases'); }
    if (this.noteService) { promises.push(this.noteService.globalSearch(searchTerm, projectId)); keys.push('notes'); }
    if (this.calendarEventService) { promises.push(this.calendarEventService.globalSearch(searchTerm, projectId)); keys.push('events'); }
    if (this.entityService) { promises.push(this.entityService.globalSearch(searchTerm, projectId)); keys.push('entities'); }
    if (this.datasetService) { promises.push(this.datasetService.globalSearch(searchTerm, projectId)); keys.push('datasets'); }

    const resolved = await Promise.all(promises);
    const data: Record<string, any[]> = {};
    keys.forEach((key, i) => { data[key] = resolved[i]; });

    const results: SearchResultDto[] = [
      ...this.mapDocs(data.docs, searchTerm),
      ...this.mapResources(data.resources, searchTerm),
      ...(data.canvases ? this.mapCanvases(data.canvases, searchTerm) : []),
      ...(data.notes ? this.mapNotes(data.notes, searchTerm) : []),
      ...(data.events ? this.mapEvents(data.events, searchTerm) : []),
      ...(data.entities ? this.mapEntities(data.entities, searchTerm) : []),
      ...(data.datasets ? this.mapDatasets(data.datasets, searchTerm) : []),
    ];

    results.sort((a, b) => b.score - a.score);
    return results;
  }

  private async searchGlobal(searchTerm: string): Promise<SearchResultDto[]> {
    const promises: Promise<any[]>[] = [];
    const keys: string[] = [];

    if (this.noteService) { promises.push(this.noteService.globalSearch(searchTerm)); keys.push('notes'); }
    if (this.calendarEventService) { promises.push(this.calendarEventService.globalSearch(searchTerm)); keys.push('events'); }
    if (this.knowledgeEntryService) { promises.push(this.knowledgeEntryService.globalSearch(searchTerm)); keys.push('knowledge'); }
    if (this.entityService) { promises.push(this.entityService.globalSearch(searchTerm)); keys.push('entities'); }
    if (this.datasetService) { promises.push(this.datasetService.globalSearch(searchTerm)); keys.push('datasets'); }

    const resolved = await Promise.all(promises);
    const data: Record<string, any[]> = {};
    keys.forEach((key, i) => { data[key] = resolved[i]; });

    const results: SearchResultDto[] = [
      ...(data.notes ? this.mapNotes(data.notes, searchTerm) : []),
      ...(data.events ? this.mapEvents(data.events, searchTerm) : []),
      ...(data.knowledge ? this.mapKnowledge(data.knowledge, searchTerm) : []),
      ...(data.entities ? this.mapEntities(data.entities, searchTerm) : []),
      ...(data.datasets ? this.mapDatasets(data.datasets, searchTerm) : []),
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

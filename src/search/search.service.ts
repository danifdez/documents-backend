import { Injectable, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
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
import { PageEntityMatch } from './dto/page-entities.dto';
import { PageBlockResult } from './dto/page-blocks.dto';

@Injectable()
export class SearchService {
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
      // Collect all terms to match for this entity
      const terms: string[] = [];

      if (entity.name && entity.name.length >= 3) {
        terms.push(entity.name);
      }

      // Aliases
      if (entity.aliases && Array.isArray(entity.aliases)) {
        for (const alias of entity.aliases) {
          if (alias.value && alias.value.length >= 3) {
            terms.push(alias.value);
          }
        }
      }

      // Translations
      if (entity.translations && typeof entity.translations === 'object') {
        for (const value of Object.values(entity.translations)) {
          if (typeof value === 'string' && value.length >= 3) {
            terms.push(value);
          }
        }
      }

      // Check which terms appear in the text using Unicode-aware boundary matching
      // \b doesn't work with accented chars (é, ñ, etc.), so we use lookaround with
      // a character class that covers word chars + Unicode letters
      const matchedTerms: string[] = [];
      for (const term of terms) {
        const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Use case-insensitive indexOf first (fast path), then verify boundaries
        const lowerText = normalizedText.toLowerCase();
        const lowerTerm = term.toLowerCase();
        let searchFrom = 0;
        while (searchFrom < lowerText.length) {
          const idx = lowerText.indexOf(lowerTerm, searchFrom);
          if (idx === -1) break;

          // Check that the character before and after is not a letter/digit (word boundary)
          const charBefore = idx > 0 ? lowerText[idx - 1] : ' ';
          const charAfter = idx + lowerTerm.length < lowerText.length ? lowerText[idx + lowerTerm.length] : ' ';
          const isWordChar = (c: string) => /[\p{L}\p{N}_]/u.test(c);

          if (!isWordChar(charBefore) && !isWordChar(charAfter)) {
            matchedTerms.push(term);
            break;
          }
          searchFrom = idx + 1;
        }
      }

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

import { Injectable } from '@nestjs/common';
import { DocService } from 'src/doc/doc.service';
import { ResourceService } from 'src/resource/resource.service';
import * as cheerio from 'cheerio';
import { SearchResultDto } from './dto/search-result.dto';

@Injectable()
export class SearchService {
  constructor(
    private readonly docService: DocService,
    private readonly resourceService: ResourceService,
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

  async globalSearch(searchTerm: string): Promise<SearchResultDto[]> {
    const docsRawResults = await this.docService.globalSearch(searchTerm);

    const docsProcessed: SearchResultDto[] = docsRawResults.map((doc: any) => ({
      id: doc.id,
      name: doc.name,
      score: doc.score,
      collection: 'docs',
      highlightedName: this.highlightTextInHtml(doc.name, searchTerm, 50),
      highlightedContent: this.highlightTextInHtml(doc.content, searchTerm, 100),
    }));

    const resourcesRawResults = await this.resourceService.globalSearch(searchTerm);

    const resourcesProcessed: SearchResultDto[] = resourcesRawResults.map((resource: any) => ({
      id: resource.id,
      name: resource.name,
      score: resource.score,
      collection: 'resources',
      highlightedTitle: this.highlightTextInHtml(resource.title, searchTerm, 50),
      highlightedName: this.highlightTextInHtml(resource.name, searchTerm, 50),
      highlightedContent: this.highlightTextInHtml(resource.content, searchTerm, 100),
    }));

    const combinedResults = [...docsProcessed, ...resourcesProcessed];

    combinedResults.sort((a, b) => b.score - a.score);

    return combinedResults;
  }
}

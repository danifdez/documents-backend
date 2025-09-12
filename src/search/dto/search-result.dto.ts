export interface SearchResultDto {
  id: number;
  name: string;
  score: number;
  collection: 'docs' | 'resources';
  highlightedName?: string;
  highlightedContent?: string;
  highlightedTitle?: string;
}

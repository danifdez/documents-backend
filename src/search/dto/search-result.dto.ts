export interface SearchResultDto {
  id: number;
  name: string;
  score: number;
  collection: 'docs' | 'resources' | 'canvases' | 'notes' | 'events' | 'knowledge' | 'entities' | 'datasets';
  highlightedName?: string;
  highlightedContent?: string;
  highlightedTitle?: string;
}

import { IsNumber, IsOptional, IsString } from 'class-validator';
import { PageEntityMatch } from './page-entities.dto';

export class PageMatchesDto {
  @IsString()
  text: string;

  @IsOptional()
  @IsNumber()
  projectId?: number;
}

export interface PageKnowledgeMatch {
  id: number;
  title: string;
  summary: string | null;
  matchedTerms: string[];
}

export interface PageTimelineMatch {
  timelineId: number;
  timelineName: string;
  eventId: string | number | null;
  title: string;
  date: string;
  endDate: string | null;
  description: string | null;
  matchedTerm: string;
  precision: 'day' | 'month' | 'year';
}

export interface PageBibliographyCreator {
  creatorType: string;
  firstName?: string;
  lastName?: string;
  name?: string;
}

export interface PageBibliographyMatch {
  id: number;
  citeKey: string | null;
  title: string | null;
  creators: PageBibliographyCreator[] | null;
  year: string | null;
  journal: string | null;
  publisher: string | null;
  doi: string | null;
  url: string | null;
  matchedTerms: string[];
  matchKinds: string[];
}

export interface PageMatchesResult {
  entities: PageEntityMatch[];
  knowledge: PageKnowledgeMatch[];
  timeline: PageTimelineMatch[];
  bibliography: PageBibliographyMatch[];
}

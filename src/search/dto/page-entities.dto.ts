import { IsString, IsOptional, IsNumber } from 'class-validator';

export class PageEntitiesDto {
  @IsString()
  text: string;

  @IsOptional()
  @IsNumber()
  projectId?: number;
}

export interface PageEntityMatch {
  id: number;
  name: string;
  type: string;
  description: string | null;
  matchedTerms: string[];
}

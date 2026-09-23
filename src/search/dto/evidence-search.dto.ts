import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { SearchResultDto } from './search-result.dto';

export class EvidenceSearchDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  query: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  projectId: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8)
  limit?: number;
}

export interface EvidenceSourceDto {
  collection: SearchResultDto['collection'];
  id: number;
  name: string;
  score: number;
  excerpt: string;
  retrieval: 'lexical';
  provenance: {
    projectId: number;
    collection: SearchResultDto['collection'];
    id: number;
  };
}

export interface EvidenceSearchResultDto {
  projectId: number;
  sources: EvidenceSourceDto[];
}

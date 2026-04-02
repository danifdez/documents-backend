import { IsArray, IsOptional, IsNumber, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { SearchResultDto } from './search-result.dto';

export class PageBlockDto {
  @IsString()
  blockId: string;

  @IsString()
  text: string;
}

export class PageBlocksDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PageBlockDto)
  blocks: PageBlockDto[];

  @IsOptional()
  @IsNumber()
  projectId?: number;
}

export interface PageBlockResult {
  blockId: string;
  results: SearchResultDto[];
}

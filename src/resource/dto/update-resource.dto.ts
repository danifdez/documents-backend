import { IsString, IsOptional, IsNumber, IsObject } from 'class-validator';

export class UpdateResourceDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  license?: string;

  @IsOptional()
  @IsString()
  publicationDate?: string;

  @IsOptional()
  @IsString()
  url?: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsObject()
  keyPoints?: any;

  @IsOptional()
  @IsObject()
  keywords?: any;

  @IsOptional()
  @IsNumber()
  type?: number;
}

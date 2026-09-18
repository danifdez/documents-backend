import { IsString, IsOptional, IsNumber } from 'class-validator';

export class CreateCommentDto {
  @IsString()
  content: string;

  @IsString()
  @IsOptional()
  quote?: string;

  @IsString()
  @IsOptional()
  prefix?: string;

  @IsString()
  @IsOptional()
  suffix?: string;

  @IsNumber()
  @IsOptional()
  position?: number;

  @IsNumber()
  @IsOptional()
  doc?: number;

  @IsNumber()
  @IsOptional()
  resource?: number;
}

export class UpdateCommentDto {
  @IsString()
  @IsOptional()
  content?: string;

  @IsString()
  @IsOptional()
  quote?: string;

  @IsString()
  @IsOptional()
  prefix?: string;

  @IsString()
  @IsOptional()
  suffix?: string;

  @IsNumber()
  @IsOptional()
  position?: number;
}

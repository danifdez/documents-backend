import { IsString, IsOptional, IsNumber, IsIn } from 'class-validator';
import { MARK_TYPES, MarkType } from '../mark.entity';

export class CreateMarkDto {
  @IsString()
  content: string;

  @IsIn(MARK_TYPES)
  @IsOptional()
  type?: MarkType;

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

export class UpdateMarkDto {
  @IsString()
  @IsOptional()
  content?: string;

  @IsIn(MARK_TYPES)
  @IsOptional()
  type?: MarkType;

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

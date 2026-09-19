import {
  IsString,
  IsOptional,
  IsNumber,
  IsIn,
  Min,
  Max,
} from 'class-validator';
import { READING_POINT_KINDS, ReadingPointKind } from '../reading-point.entity';

export class CreateReadingPointDto {
  @IsIn(READING_POINT_KINDS)
  @IsOptional()
  kind?: ReadingPointKind;

  @IsString()
  @IsOptional()
  label?: string;

  @IsString()
  @IsOptional()
  fragmentId?: string;

  @IsString()
  @IsOptional()
  exact?: string;

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
  @Min(0)
  @Max(1)
  @IsOptional()
  ratio?: number;

  @IsNumber()
  @IsOptional()
  doc?: number;

  @IsNumber()
  @IsOptional()
  resource?: number;
}

export class UpdateReadingPointDto {
  @IsIn(READING_POINT_KINDS)
  @IsOptional()
  kind?: ReadingPointKind;

  @IsString()
  @IsOptional()
  label?: string;

  @IsString()
  @IsOptional()
  fragmentId?: string;

  @IsString()
  @IsOptional()
  exact?: string;

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
  @Min(0)
  @Max(1)
  @IsOptional()
  ratio?: number;
}

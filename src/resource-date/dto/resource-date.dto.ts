import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsISO8601 } from 'class-validator';
import { DatePrecision, DateResolver } from '../resource-date.entity';

export class ResourceDatePayload {
  @IsOptional()
  @IsISO8601()
  date?: string | null;

  @IsOptional()
  @IsISO8601()
  endDate?: string | null;

  @IsString()
  rawExpression: string;

  @IsOptional()
  @IsIn(['day', 'month', 'year'])
  precision?: DatePrecision | null;

  @IsOptional()
  @IsInt()
  charOffset?: number | null;

  @IsOptional()
  @IsString()
  contextSnippet?: string | null;

  @IsIn(['dateparser', 'llm', 'unresolved'])
  resolver: DateResolver;

  @IsOptional()
  @IsBoolean()
  isRelative?: boolean;

  @IsOptional()
  @IsString()
  unresolvedReason?: string | null;
}

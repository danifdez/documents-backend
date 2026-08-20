import {
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsEnum,
  IsString,
} from 'class-validator';
import { ExecutionType } from '../execution-type.enum';

export class CreateExecutionDto {
  @IsEnum(ExecutionType)
  @IsNotEmpty()
  taskType: ExecutionType;

  @IsString()
  @IsOptional()
  content?: string;

  @IsString()
  @IsOptional()
  sourceLanguage?: string;

  @IsString()
  @IsOptional()
  targetLanguage?: string;

  @IsNumber()
  @IsOptional()
  resourceId?: number;
}

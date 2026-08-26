import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { MemoryEntryType } from '../memory-entry.entity';

const MEMORY_TYPES: MemoryEntryType[] = ['fact', 'preference', 'episode'];

export class CreateMemoryEntryDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(120)
  name: string;

  @IsString()
  @IsIn(MEMORY_TYPES)
  type: MemoryEntryType;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(16_000)
  body: string;
}

export class UpdateMemoryEntryDto {
  @IsString()
  @IsOptional()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(120)
  name?: string;

  @IsString()
  @IsOptional()
  @IsIn(MEMORY_TYPES)
  type?: MemoryEntryType;

  @IsString()
  @IsOptional()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(16_000)
  body?: string;
}

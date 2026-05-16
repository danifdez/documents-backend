import { IsString, IsNotEmpty, IsOptional, MaxLength, IsIn } from 'class-validator';

const MEMORY_TYPES = ['fact', 'event', 'instruction'] as const;

export class CreateMemoryEntryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsString()
  @IsIn([...MEMORY_TYPES])
  type: typeof MEMORY_TYPES[number];

  @IsString()
  @IsNotEmpty()
  body: string;
}

export class UpdateMemoryEntryDto {
  @IsString()
  @IsOptional()
  @MaxLength(120)
  name?: string;

  @IsString()
  @IsOptional()
  @IsIn([...MEMORY_TYPES])
  type?: typeof MEMORY_TYPES[number];

  @IsString()
  @IsOptional()
  body?: string;
}

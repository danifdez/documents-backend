import { IsString, IsOptional } from 'class-validator';

export class ImportDatasetDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  projectId?: string;
}

export class ImportConfirmDto {
  @IsString()
  mappings: string;

  @IsOptional()
  skipFirstRow?: string | boolean;
}

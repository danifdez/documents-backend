import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  MaxLength,
} from 'class-validator';

export class CreateFavoriteCategoryDto {
  @IsNumber()
  projectId: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsNumber()
  parentId?: number | null;
}

export class UpdateFavoriteCategoryDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsNumber()
  parentId?: number | null;
}

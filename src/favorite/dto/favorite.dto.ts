import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  MaxLength,
} from 'class-validator';

export class CreateFavoriteDto {
  @IsNumber()
  projectId: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  url: string;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  title?: string;

  @IsOptional()
  @IsNumber()
  categoryId?: number | null;
}

export class UpdateFavoriteDto {
  @IsString()
  @IsOptional()
  @MaxLength(300)
  title?: string;

  @IsString()
  @IsOptional()
  @IsNotEmpty()
  @MaxLength(2000)
  url?: string;

  @IsOptional()
  @IsNumber()
  categoryId?: number | null;
}

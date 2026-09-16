import { IsString, IsNotEmpty, IsOptional, IsNumber, MaxLength } from 'class-validator';

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
}

export class UpdateFavoriteDto {
  @IsString()
  @IsOptional()
  @MaxLength(300)
  title?: string;
}

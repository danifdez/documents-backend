import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

export class CreateResourceTypeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  abbreviation: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  example?: string;
}

export class UpdateResourceTypeDto {
  @IsString()
  @IsOptional()
  @MaxLength(20)
  abbreviation?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  example?: string;
}

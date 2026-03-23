import { IsString, IsOptional, IsNumber } from 'class-validator';

export class CreateMarkDto {
  @IsString()
  content: string;

  @IsNumber()
  @IsOptional()
  doc?: number;

  @IsNumber()
  @IsOptional()
  resource?: number;
}

export class UpdateMarkDto {
  @IsString()
  @IsOptional()
  content?: string;
}

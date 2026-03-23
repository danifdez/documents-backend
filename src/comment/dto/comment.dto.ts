import { IsString, IsOptional, IsNumber } from 'class-validator';

export class CreateCommentDto {
  @IsString()
  content: string;

  @IsNumber()
  @IsOptional()
  doc?: number;

  @IsNumber()
  @IsOptional()
  resource?: number;
}

export class UpdateCommentDto {
  @IsString()
  @IsOptional()
  content?: string;
}

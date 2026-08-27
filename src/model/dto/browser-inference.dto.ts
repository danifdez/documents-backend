import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class BrowserInferenceDto {
  @IsString()
  @MinLength(2)
  @MaxLength(250_000)
  requestJson: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  detail?: string;
}

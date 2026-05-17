import { IsString, IsNotEmpty, IsOptional, IsBoolean, MaxLength, ValidateIf } from 'class-validator';

export class WriteIndexedFileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  filename: string;

  // Exactly one of `content` (UTF-8 text) or `contentBase64` (binary) must be
  // provided. We can't use a single field because text content typically
  // isn't valid base64 and we want a clear signal of intent.
  @ValidateIf((o) => o.contentBase64 === undefined)
  @IsString()
  content?: string;

  @ValidateIf((o) => o.content === undefined)
  @IsString()
  contentBase64?: string;

  @IsBoolean()
  @IsOptional()
  overwrite?: boolean;
}

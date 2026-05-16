import { IsString, IsNotEmpty, IsOptional, MaxLength, IsBoolean } from 'class-validator';

export class CreateAssistantDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsString()
  @IsOptional()
  systemPrompt?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  folderScope?: string;

  @IsString()
  @IsOptional()
  @MaxLength(16)
  icon?: string;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  sub?: string;

  @IsBoolean()
  @IsOptional()
  pinned?: boolean;
}

export class UpdateAssistantDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;

  @IsString()
  @IsOptional()
  systemPrompt?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  folderScope?: string;

  @IsString()
  @IsOptional()
  @MaxLength(16)
  icon?: string;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  sub?: string;

  @IsBoolean()
  @IsOptional()
  pinned?: boolean;
}

export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  content: string;
}

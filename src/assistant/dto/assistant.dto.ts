import {
  IsDefined,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class UpdateAssistantWorkingFolderDto {
  @IsDefined()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(500)
  folderScope: string | null;
}

export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  content: string;
}

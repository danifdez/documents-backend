import {
  IsDefined,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { MAX_CHAT_MESSAGE_CHARS } from '../../conversation/conversation.constants';

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
  @MaxLength(MAX_CHAT_MESSAGE_CHARS)
  content: string;
}

import { IndexedFileEntity } from '../indexed-file.entity';

export class IndexedFileDto {
  id: number;
  filename: string;
  filePath: string;
  mimeType: string;
  size: number;
  mtime: Date;
  createdAt: Date;
  updatedAt: Date;
  // null while extraction is still pending; '' when the file mimeType is not extractable.
  hasExtractedText: boolean | null;
}

export function toIndexedFileDto(entity: IndexedFileEntity): IndexedFileDto {
  return {
    id: entity.id,
    filename: entity.filename,
    filePath: entity.filePath,
    mimeType: entity.mimeType,
    size: typeof entity.size === 'string' ? Number(entity.size) : entity.size,
    mtime: entity.mtime,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    hasExtractedText: entity.extractedText === null
      ? null
      : entity.extractedText.length > 0,
  };
}

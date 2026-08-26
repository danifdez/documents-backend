import { Injectable, Logger } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { ExecutionPriority } from '../../execution/execution-priority.enum';
import { ResourceService } from '../../resource/resource.service';
import { ExecutionService } from '../../execution/execution.service';
import { ExecutionEntity } from '../../execution/execution.entity';
import { FileStorageService } from '../../file-storage/file-storage.service';

const MEDIA_EXTENSIONS = new Set([
  '.mp3',
  '.wav',
  '.ogg',
  '.flac',
  '.aac',
  '.m4a',
  '.wma',
  '.opus',
  '.aiff',
  '.aif',
  '.mp4',
  '.m4v',
  '.mov',
  '.avi',
  '.mkv',
  '.webm',
  '.wmv',
]);

@Injectable()
export class DocumentExtractionProcessor implements ExecutionProcessor {
  private readonly logger = new Logger(DocumentExtractionProcessor.name);
  private readonly TASK_TYPE = 'document-extraction';

  constructor(
    private readonly resourceService: ResourceService,
    private readonly executionService: ExecutionService,
    private readonly fileStorageService: FileStorageService,
  ) {}

  canProcess(taskType: string): boolean {
    return taskType === this.TASK_TYPE;
  }

  async process(execution: ExecutionEntity): Promise<any> {
    const hash = execution.payload['hash'] as string;
    const extension = execution.payload['extension'] as string;
    const resourceId = Number(execution.payload['resourceId']) as number;
    const result = execution.result as {
      title: string;
      author: string;
      publication_date: Date;
      content: string;
      pages?: number;
    };

    if (!hash || !extension || !resourceId || !result) {
      throw new Error(
        'Execution payload missing required parameters (hash, extension, resourceId, or result)',
      );
    }

    const { title, author, publication_date, content, pages } = result;
    const isMedia = MEDIA_EXTENSIONS.has(extension.toLowerCase());

    const updateData: any = {
      title,
      author,
      publicationDate: publication_date,
      content,
      status: isMedia ? 'transcribing' : 'extracted',
    };

    if (pages !== undefined) {
      updateData.pages = pages;
    }

    await this.resourceService.update(resourceId, updateData);

    if (isMedia) {
      const relativePath = this.fileStorageService.getRelativePath(
        hash,
        extension,
      );
      const buffer = await this.fileStorageService.getFile(relativePath);
      if (!buffer) {
        throw new Error(`Audio file not found for transcribe: ${relativePath}`);
      }
      await this.executionService.createInference(
        'transcribe',
        ExecutionPriority.BACKGROUND,
        {
          hash,
          extension,
          resourceId,
        },
        {
          rootExecutionId: execution.rootExecutionId,
          parentExecutionId: execution.executionId,
          ownerPrincipal: execution.ownerPrincipal,
          inputArtifacts: [
            {
              role: 'media',
              kind: 'source_media',
              mediaType: 'application/octet-stream',
              body: buffer,
            },
          ],
        },
      );
    }

    return {
      success: true,
      resourceId,
      status: 'extracted',
      publication: {
        socketEvent: 'notification',
        payload: {
          type: 'document-extraction',
          message:
            `Document extraction completed for resource with hash ${hash}. ` +
            'Ready for confirmation.',
          resourceId,
        },
      },
    };
  }
}

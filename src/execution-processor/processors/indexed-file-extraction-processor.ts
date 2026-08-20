import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExecutionProcessor } from '../execution-processor.interface';
import { ExecutionEntity } from 'src/execution/execution.entity';
import { ExecutionService } from 'src/execution/execution.service';
import { ExecutionPriority } from 'src/execution/execution-priority.enum';
import { IndexedFileEntity } from 'src/indexed-file/indexed-file.entity';

@Injectable()
export class IndexedFileExtractionProcessor implements ExecutionProcessor {
  private readonly logger = new Logger(IndexedFileExtractionProcessor.name);
  private readonly TASK_TYPE = 'indexed-file-extraction';

  constructor(
    @InjectRepository(IndexedFileEntity)
    private readonly repository: Repository<IndexedFileEntity>,
    private readonly executionService: ExecutionService,
  ) {}

  canProcess(taskType: string): boolean {
    return taskType === this.TASK_TYPE;
  }

  async process(execution: ExecutionEntity): Promise<any> {
    const indexedFileId = Number(execution.payload['indexedFileId']);
    if (!indexedFileId) {
      throw new Error(
        'indexed-file-extraction execution missing indexedFileId',
      );
    }

    const file = await this.repository.findOne({
      where: { id: indexedFileId },
    });
    if (!file) {
      this.logger.warn(
        `IndexedFile ${indexedFileId} no longer exists; skipping`,
      );
      return { success: false, reason: 'not_found' };
    }

    const executionChecksum = execution.payload['checksum'] as
      string | undefined;
    if (executionChecksum && executionChecksum !== file.checksum) {
      this.logger.log(
        `[indexed-file] discarding stale extraction for id=${indexedFileId} (checksum changed)`,
      );
      return { success: false, reason: 'stale' };
    }

    const result = execution.result as {
      content?: string;
      error?: string;
    } | null;
    const text = typeof result?.content === 'string' ? result.content : '';

    file.extractedText = text;
    await this.repository.save(file);

    this.logger.log(
      `[indexed-file] extracted text for id=${indexedFileId} length=${text.length}`,
    );

    if (text) {
      await this.executionService.create(
        'indexed-file-ingest',
        ExecutionPriority.NORMAL,
        {
          indexedFileId: file.id,
          ownerType: file.ownerType,
          ownerId: file.ownerId,
          content: text,
          filename: file.filename,
          checksum: file.checksum,
        },
      );
    }

    return { success: true, indexedFileId, length: text.length };
  }
}

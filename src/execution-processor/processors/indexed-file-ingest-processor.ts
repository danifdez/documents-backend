import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExecutionProcessor } from '../execution-processor.interface';
import { ExecutionEntity } from '../../execution/execution.entity';
import { IndexedFileEntity } from '../../indexed-file/indexed-file.entity';
import { sourceIdForIndexedFile } from '../../vector/vector-source-id.util';
import {
  VectorPointInput,
  VectorStoreService,
} from '../../vector/vector-store.service';

@Injectable()
export class IndexedFileIngestProcessor implements ExecutionProcessor {
  private readonly logger = new Logger(IndexedFileIngestProcessor.name);
  private readonly TASK_TYPE = 'indexed-file-ingest';

  constructor(
    @InjectRepository(IndexedFileEntity)
    private readonly repository: Repository<IndexedFileEntity>,
    private readonly vectorStore: VectorStoreService,
  ) {}

  canProcess(taskType: string): boolean {
    return taskType === this.TASK_TYPE;
  }

  async process(execution: ExecutionEntity): Promise<any> {
    const indexedFileId = Number(execution.payload['indexedFileId']);
    if (!indexedFileId) {
      throw new Error('indexed-file-ingest execution missing indexedFileId');
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
        `[indexed-file] discarding stale ingest for id=${indexedFileId} (checksum changed)`,
      );
      return { success: false, reason: 'stale' };
    }

    const result = execution.result as {
      chunks?: number;
      sourceId?: string;
      points?: unknown[];
    } | null;
    const chunks = Number(result?.chunks ?? 0);
    if (!Array.isArray(result?.points) || chunks !== result.points.length) {
      throw new Error('indexed-file-ingest result has invalid points');
    }
    await this.vectorStore.replaceIndexedFile(
      indexedFileId,
      `${file.ownerType}:${file.ownerId}`,
      result.points as VectorPointInput[],
    );

    file.embeddingId = chunks > 0 ? sourceIdForIndexedFile(file.id) : null;
    await this.repository.save(file);

    this.logger.log(
      `[indexed-file] ingested vectors id=${indexedFileId} chunks=${chunks}`,
    );

    return { success: true, indexedFileId, chunks };
  }
}

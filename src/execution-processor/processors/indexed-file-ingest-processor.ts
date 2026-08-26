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
import { ExecutionArtifactService } from '../../execution/execution-artifact.service';

@Injectable()
export class IndexedFileIngestProcessor implements ExecutionProcessor {
  private readonly logger = new Logger(IndexedFileIngestProcessor.name);
  private readonly TASK_TYPE = 'indexed-file-ingest';

  constructor(
    @InjectRepository(IndexedFileEntity)
    private readonly repository: Repository<IndexedFileEntity>,
    private readonly vectorStore: VectorStoreService,
    private readonly artifacts: ExecutionArtifactService,
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
      pointCount?: number;
      sourceId?: string;
    } | null;
    const chunks = Number(result?.chunks ?? 0);
    const pointCount = Number(result?.pointCount);
    const documents = await this.artifacts.readOutputJson(
      execution,
      'vector_points',
      'vector_points',
    );
    const points = documents.flatMap((document) => {
      if (!Array.isArray(document.points)) {
        throw new Error(
          'indexed-file-ingest vector_points artifact is invalid',
        );
      }
      return document.points as VectorPointInput[];
    });
    if (
      !Number.isInteger(chunks) ||
      chunks < 0 ||
      !Number.isInteger(pointCount) ||
      pointCount !== chunks ||
      points.length !== pointCount
    ) {
      throw new Error('indexed-file-ingest result has invalid point artifacts');
    }
    await this.vectorStore.replaceIndexedFile(
      indexedFileId,
      `${file.ownerType}:${file.ownerId}`,
      points,
    );

    file.embeddingId = chunks > 0 ? sourceIdForIndexedFile(file.id) : null;
    await this.repository.save(file);

    this.logger.log(
      `[indexed-file] ingested vectors id=${indexedFileId} chunks=${chunks}`,
    );

    return { success: true, indexedFileId, chunks };
  }
}

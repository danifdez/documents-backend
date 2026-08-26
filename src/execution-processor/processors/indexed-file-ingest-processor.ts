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
import { ExecutionEffectJournalService } from '../../execution/execution-effect-journal.service';
import {
  canonicalHash,
  contentHash,
} from '../../execution/execution-canonical';

class IndexedFileIngestNotFoundError extends Error {}
class IndexedFileIngestStaleError extends Error {}

@Injectable()
export class IndexedFileIngestProcessor implements ExecutionProcessor {
  private readonly logger = new Logger(IndexedFileIngestProcessor.name);
  private readonly TASK_TYPE = 'indexed-file-ingest';

  constructor(
    @InjectRepository(IndexedFileEntity)
    private readonly repository: Repository<IndexedFileEntity>,
    private readonly vectorStore: VectorStoreService,
    private readonly artifacts: ExecutionArtifactService,
    private readonly effectJournal: ExecutionEffectJournalService,
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
    const ownerTag = `${file.ownerType}:${file.ownerId}`;
    try {
      await this.effectJournal.runVerified(
        {
          executionId: execution.executionId,
          effectKey: `indexed-file-ingest:${indexedFileId}`,
          effectType: 'indexed_file_vectors_replace',
          resourceKey: `indexed-file:${indexedFileId}`,
          intent: {
            indexedFileId,
            checksum: executionChecksum ?? file.checksum,
            ownerTag,
            pointCount,
            pointsHash: contentHash(JSON.stringify(points)),
          },
        },
        async (manager) => {
          const repository = manager.getRepository(IndexedFileEntity);
          const current = await repository.findOne({
            where: { id: indexedFileId },
            lock: { mode: 'pessimistic_write' },
          });
          if (!current) throw new IndexedFileIngestNotFoundError();
          if (executionChecksum && executionChecksum !== current.checksum) {
            throw new IndexedFileIngestStaleError();
          }
          const currentOwnerTag = `${current.ownerType}:${current.ownerId}`;
          if (currentOwnerTag !== ownerTag) {
            throw new IndexedFileIngestStaleError();
          }
          const vectors = await this.vectorStore.replaceIndexedFileVerified(
            indexedFileId,
            ownerTag,
            points,
            manager,
          );
          const embeddingId =
            chunks > 0 ? sourceIdForIndexedFile(current.id) : null;
          current.embeddingId = embeddingId;
          await repository.save(current);
          const observed = await repository.findOneBy({ id: indexedFileId });
          if (
            observed?.embeddingId !== embeddingId ||
            observed.checksum !== current.checksum
          ) {
            throw new Error('indexed_file_ingest_effect_not_verified');
          }
          return {
            indexedFileId,
            checksum: current.checksum,
            ownerTag,
            embeddingId,
            pointCount: vectors.pointCount,
            pointIdsHash: canonicalHash(vectors.pointIds),
          };
        },
      );
    } catch (error) {
      if (error instanceof IndexedFileIngestNotFoundError) {
        return { success: false, reason: 'not_found' };
      }
      if (error instanceof IndexedFileIngestStaleError) {
        return { success: false, reason: 'stale' };
      }
      throw error;
    }

    this.logger.log(
      `[indexed-file] ingested vectors id=${indexedFileId} chunks=${chunks}`,
    );

    return { success: true, indexedFileId, chunks };
  }
}

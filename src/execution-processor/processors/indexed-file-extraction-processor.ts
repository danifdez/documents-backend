import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExecutionProcessor } from '../execution-processor.interface';
import { ExecutionEntity } from '../../execution/execution.entity';
import { ExecutionService } from '../../execution/execution.service';
import { IndexedFileEntity } from '../../indexed-file/indexed-file.entity';
import { ExecutionEffectJournalService } from '../../execution/execution-effect-journal.service';
import { canonicalHash } from '../../execution/execution-canonical';

class IndexedFileExtractionNotFoundError extends Error {}
class IndexedFileExtractionStaleError extends Error {}

@Injectable()
export class IndexedFileExtractionProcessor implements ExecutionProcessor {
  private readonly logger = new Logger(IndexedFileExtractionProcessor.name);
  private readonly TASK_TYPE = 'indexed-file-extraction';

  constructor(
    @InjectRepository(IndexedFileEntity)
    private readonly repository: Repository<IndexedFileEntity>,
    private readonly executionService: ExecutionService,
    private readonly effectJournal: ExecutionEffectJournalService,
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

    let observation: Record<string, unknown>;
    try {
      const effect = await this.effectJournal.runVerified(
        {
          executionId: execution.executionId,
          effectKey: `indexed-file-extraction:${indexedFileId}`,
          effectType: 'indexed_file_text_replace',
          resourceKey: `indexed-file:${indexedFileId}`,
          intent: {
            indexedFileId,
            checksum: executionChecksum ?? file.checksum,
            text,
          },
        },
        async (manager) => {
          const repository = manager.getRepository(IndexedFileEntity);
          const current = await repository.findOne({
            where: { id: indexedFileId },
            lock: { mode: 'pessimistic_write' },
          });
          if (!current) throw new IndexedFileExtractionNotFoundError();
          if (executionChecksum && executionChecksum !== current.checksum) {
            throw new IndexedFileExtractionStaleError();
          }
          const before = current.extractedText;
          current.extractedText = text;
          await repository.save(current);
          const observed = await repository.findOneBy({ id: indexedFileId });
          if (
            observed?.extractedText !== text ||
            observed.checksum !== current.checksum
          ) {
            throw new Error('indexed_file_extraction_effect_not_verified');
          }
          return {
            indexedFileId,
            ownerType: current.ownerType,
            ownerId: current.ownerId,
            filename: current.filename,
            checksum: current.checksum,
            textLength: text.length,
            beforeTextHash: canonicalHash(before),
            afterTextHash: canonicalHash(text),
          };
        },
      );
      observation = effect.observation;
    } catch (error) {
      if (error instanceof IndexedFileExtractionNotFoundError) {
        return { success: false, reason: 'not_found' };
      }
      if (error instanceof IndexedFileExtractionStaleError) {
        return { success: false, reason: 'stale' };
      }
      throw error;
    }

    this.logger.log(
      `[indexed-file] extracted text for id=${indexedFileId} length=${text.length}`,
    );

    if (text) {
      const ownerType = observation.ownerType;
      const ownerId = Number(observation.ownerId);
      const filename = observation.filename;
      const checksum = observation.checksum;
      if (
        !['assistant', 'agent'].includes(String(ownerType)) ||
        !Number.isInteger(ownerId) ||
        ownerId <= 0 ||
        typeof filename !== 'string' ||
        typeof checksum !== 'string'
      ) {
        throw new Error('indexed_file_extraction_observation_invalid');
      }
      const current = await this.repository.findOne({
        where: { id: indexedFileId },
      });
      if (!current) return { success: false, reason: 'not_found' };
      if (current.checksum !== checksum) {
        return { success: false, reason: 'stale' };
      }
      if (!execution.lastEventId) {
        throw new Error('Indexed-file extraction has no causal event');
      }
      const payload = {
        indexedFileId,
        ownerType,
        ownerId,
        content: text,
        filename,
        checksum,
      };
      await this.executionService.createChildInferenceOnce(
        execution.executionId,
        `indexed-file-extraction:ingest:${indexedFileId}:${checksum}`,
        {
          taskType: 'indexed-file-ingest',
          payload,
          work: { taskType: 'indexed-file-ingest', payload },
          requiredCapability: 'indexed-file-ingest',
          causedByEventId: execution.lastEventId,
        },
      );
    }

    return { success: true, indexedFileId, length: text.length };
  }
}

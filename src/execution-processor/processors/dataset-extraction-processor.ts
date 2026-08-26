import { Injectable, Logger } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { ExecutionEntity } from '../../execution/execution.entity';
import { CellAnchor } from '../../dataset/cell-anchor.type';
import { DatasetRecordEntity } from '../../dataset/dataset-record.entity';
import { ExecutionEffectJournalService } from '../../execution/execution-effect-journal.service';
import { canonicalDomainHash } from '../../execution/execution-canonical';
import { isDeepStrictEqual } from 'node:util';

class DatasetExtractionRecordNotFoundError extends Error {}
class DatasetExtractionRecordChangedError extends Error {}

@Injectable()
export class DatasetExtractionProcessor implements ExecutionProcessor {
  private readonly logger = new Logger(DatasetExtractionProcessor.name);

  constructor(private readonly effectJournal: ExecutionEffectJournalService) {}

  canProcess(taskType: string): boolean {
    return taskType === 'dataset.extract-row';
  }

  async process(execution: ExecutionEntity): Promise<any> {
    const payload = (execution.payload || {}) as {
      datasetId?: number;
      recordId?: number;
      columnsToExtract?: string[];
    };
    const recordId = Number(payload.recordId);
    const datasetId = Number(payload.datasetId);
    const columns = Array.isArray(payload.columnsToExtract)
      ? payload.columnsToExtract
      : [];

    if (!recordId || !datasetId) {
      this.logger.warn(
        `dataset.extract-row execution ${execution.executionId} ` +
          'missing datasetId/recordId in payload',
      );
      return { success: false, message: 'Invalid payload' };
    }

    const result = execution.result as {
      data?: Record<string, unknown>;
      cellMetadata?: Record<string, CellAnchor>;
      model?: string;
      promptVersion?: string;
    } | null;
    const executionError = execution.error as Record<string, unknown> | null;
    let status: 'extracted' | 'failed';
    let failureMessage: string | null = null;

    if (execution.phase === 'domain_failure_finalization') {
      failureMessage =
        typeof executionError?.message === 'string'
          ? executionError.message
          : 'Dataset extraction failed';
      status = 'failed';
    } else if (
      !result ||
      !result.data ||
      typeof result.data !== 'object' ||
      Array.isArray(result.data) ||
      !result.cellMetadata ||
      typeof result.cellMetadata !== 'object' ||
      Array.isArray(result.cellMetadata)
    ) {
      failureMessage = 'Invalid dataset extraction result';
      status = 'failed';
    } else {
      status = 'extracted';
    }

    try {
      await this.effectJournal.runVerified(
        {
          executionId: execution.executionId,
          effectKey: `dataset-extraction:${recordId}`,
          effectType: 'dataset_record_extraction_replace',
          resourceKey: `dataset-record:${recordId}`,
          intent: {
            datasetId,
            recordId,
            status,
            resultHash: canonicalDomainHash({
              result,
              columns,
              failureMessage,
            }),
          },
        },
        async (manager) => {
          const repository = manager.getRepository(DatasetRecordEntity);
          const record = await repository.findOne({
            where: { id: recordId },
            relations: ['dataset'],
            lock: { mode: 'pessimistic_write' },
          });
          if (!record) throw new DatasetExtractionRecordNotFoundError();
          if (record.dataset?.id !== datasetId) {
            throw new DatasetExtractionRecordChangedError();
          }
          const before = {
            data: record.data,
            cellMetadata: record.cellMetadata,
            extractionStatus: record.extractionStatus,
            extractionError: record.extractionError,
          };
          if (status === 'failed') {
            record.extractionStatus = 'failed';
            record.extractionError = failureMessage;
          } else {
            const data = { ...(record.data || {}) };
            const cellMetadata = { ...(record.cellMetadata || {}) };
            for (const fieldKey of columns) {
              const currentAnchor = cellMetadata[fieldKey];
              if (currentAnchor?.editedByUser || !(fieldKey in result!.data!)) {
                continue;
              }
              const newValue = result!.data![fieldKey];
              data[fieldKey] = newValue;
              if (newValue == null) {
                delete cellMetadata[fieldKey];
              } else if (result!.cellMetadata![fieldKey]) {
                cellMetadata[fieldKey] = result!.cellMetadata![fieldKey];
              }
            }
            record.data = data;
            record.cellMetadata = cellMetadata;
            record.extractionStatus = 'extracted';
            record.extractionError = null;
          }
          await repository.save(record);
          const observed = await repository.findOne({
            where: { id: recordId },
            relations: ['dataset'],
          });
          if (
            observed?.dataset?.id !== datasetId ||
            observed.extractionStatus !== record.extractionStatus ||
            observed.extractionError !== record.extractionError ||
            !isDeepStrictEqual(observed.data, record.data) ||
            !isDeepStrictEqual(observed.cellMetadata, record.cellMetadata)
          ) {
            throw new Error('dataset_extraction_effect_not_verified');
          }
          return {
            datasetId,
            recordId,
            beforeHash: canonicalDomainHash(before),
            afterHash: canonicalDomainHash({
              data: record.data,
              cellMetadata: record.cellMetadata,
              extractionStatus: record.extractionStatus,
              extractionError: record.extractionError,
            }),
            status,
          };
        },
      );
    } catch (error) {
      if (error instanceof DatasetExtractionRecordNotFoundError) {
        return { success: false, reason: 'not_found' };
      }
      if (error instanceof DatasetExtractionRecordChangedError) {
        return { success: false, reason: 'stale' };
      }
      throw error;
    }

    const publication = {
      socketEvent: 'notification',
      payload: {
        type: execution.taskType,
        message:
          status === 'failed'
            ? `Dataset extraction failed for row ${recordId}`
            : `Dataset row ${recordId} extracted`,
        datasetId,
        recordId,
        extractionStatus: status,
        executionId: execution.executionId,
      },
    };

    return {
      success: status !== 'failed',
      message: failureMessage ?? `record ${recordId} -> ${status}`,
      publication,
    };
  }
}

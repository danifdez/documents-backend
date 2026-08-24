import { Injectable, Logger } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { ExecutionEntity } from '../../execution/execution.entity';
import { DatasetExtractionService } from '../../dataset/dataset-extraction.service';

@Injectable()
export class DatasetExtractionProcessor implements ExecutionProcessor {
  private readonly logger = new Logger(DatasetExtractionProcessor.name);

  constructor(private readonly extractionService: DatasetExtractionService) {}

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
        `dataset.extract-row execution ${execution.executionId} missing datasetId/recordId in payload`,
      );
      return { success: false, message: 'Invalid payload' };
    }

    const result = (execution.result || {}) as any;
    const { status } = await this.extractionService.applyExtractionResult(
      recordId,
      result,
      columns,
    );

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
      message: `record ${recordId} -> ${status}`,
      publication,
    };
  }
}

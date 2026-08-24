import { Injectable, Logger } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { ExecutionEntity } from 'src/execution/execution.entity';

const DATASET_TASK_TYPES = new Set([
  'distribution',
  'correlation',
  'correlation-matrix',
  'group-by',
  'time-series',
  'outliers',
  'pivot-table',
  'summary',
  'query',
  'chart',
]);

@Injectable()
export class DatasetStatsProcessor implements ExecutionProcessor {
  private readonly logger = new Logger(DatasetStatsProcessor.name);

  canProcess(taskType: string): boolean {
    return DATASET_TASK_TYPES.has(taskType);
  }

  async process(execution: ExecutionEntity): Promise<any> {
    const datasetId = execution.payload['datasetId'];
    const result = execution.result as Record<string, any>;

    if (result?.error) {
      this.logger.warn(
        `Stats analysis failed for dataset ${datasetId}: ${result.error}`,
      );
    }

    const payload = {
      type: execution.taskType,
      message: result?.error
        ? `Statistical analysis failed for dataset`
        : `Statistical analysis completed`,
      datasetId,
      executionId: execution.executionId,
    };

    return {
      success: !result?.error,
      message: 'Dataset stats processed',
      publication: { socketEvent: 'notification', payload },
    };
  }
}

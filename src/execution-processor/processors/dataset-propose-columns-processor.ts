import { Injectable } from '@nestjs/common';
import { ExecutionEntity } from '../../execution/execution.entity';
import {
  ExecutionProcessor,
  ExecutionProcessorResult,
} from '../execution-processor.interface';

@Injectable()
export class DatasetProposeColumnsProcessor implements ExecutionProcessor {
  canProcess(taskType: string): boolean {
    return taskType === 'dataset.propose-columns';
  }

  process(execution: ExecutionEntity): Promise<ExecutionProcessorResult> {
    return Promise.resolve().then(() => {
      const result = execution.result as { columns?: unknown } | null;
      if (!Array.isArray(result?.columns) || result.columns.length === 0) {
        return {
          success: false,
          reason: 'invalid_column_proposal',
        };
      }
      return { success: true };
    });
  }
}

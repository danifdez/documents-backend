import { Injectable } from '@nestjs/common';
import {
  ExecutionProcessor,
  ExecutionProcessorResult,
} from '../execution-processor.interface';
import { ExecutionEntity } from '../../execution/execution.entity';
import { isDatasetAnalysisTaskType } from '../../dataset/dataset-analysis.types';

@Injectable()
export class DatasetStatsProcessor implements ExecutionProcessor {
  canProcess(taskType: string): boolean {
    return isDatasetAnalysisTaskType(taskType);
  }

  process(execution: ExecutionEntity): Promise<ExecutionProcessorResult> {
    return Promise.resolve().then(() => {
      const datasetId = execution.payload['datasetId'];
      const result = execution.result as Record<string, unknown> | null;
      if (!result || typeof result !== 'object') {
        return { success: false, reason: 'invalid_dataset_analysis_result' };
      }

      const payload = {
        type: execution.taskType,
        message: 'Statistical analysis completed',
        datasetId,
        datasetIds: execution.payload['datasetIds'],
        executionId: execution.executionId,
      };

      return {
        success: true,
        message: 'Dataset stats processed',
        publication: { socketEvent: 'notification', payload },
      };
    });
  }
}

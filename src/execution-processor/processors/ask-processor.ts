import { Injectable } from '@nestjs/common';
import {
  ExecutionProcessor,
  ExecutionProcessorResult,
} from '../execution-processor.interface';
import { ExecutionEntity } from '../../execution/execution.entity';

@Injectable()
export class AskProcessor implements ExecutionProcessor {
  private readonly TASK_TYPE = 'ask';

  canProcess(taskType: string): boolean {
    return taskType === this.TASK_TYPE;
  }

  process(execution: ExecutionEntity): Promise<ExecutionProcessorResult> {
    return Promise.resolve().then(() => {
      const response = execution.result['response'] as string;
      const requestId = execution.payload['requestId'] as string | undefined;

      return {
        success: true,
        publication: {
          socketEvent: 'askResponse',
          payload: { response, requestId },
        },
      };
    });
  }
}

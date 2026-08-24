import { Injectable } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { ExecutionEntity } from 'src/execution/execution.entity';

@Injectable()
export class SearchProcessor implements ExecutionProcessor {
  private readonly TASK_TYPE = 'search';

  canProcess(taskType: string): boolean {
    return taskType === this.TASK_TYPE;
  }

  async process(execution: ExecutionEntity): Promise<any> {
    const results = execution.result['results'] as any[];
    const requestId = execution.payload['requestId'] as string | undefined;

    return {
      success: true,
      publication: {
        socketEvent: 'searchResponse',
        payload: { results, requestId },
      },
    };
  }
}

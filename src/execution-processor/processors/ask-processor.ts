import { Injectable } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { ExecutionEntity } from 'src/execution/execution.entity';

@Injectable()
export class AskProcessor implements ExecutionProcessor {
  private readonly TASK_TYPE = 'ask';

  canProcess(taskType: string): boolean {
    return taskType === this.TASK_TYPE;
  }

  async process(execution: ExecutionEntity): Promise<any> {
    const response = execution.result['response'] as string;
    const requestId = execution.payload['requestId'] as string | undefined;

    return {
      success: true,
      publication: {
        socketEvent: 'askResponse',
        payload: { response, requestId },
      },
    };
  }
}

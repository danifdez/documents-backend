import { Injectable } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { ExecutionEntity } from 'src/execution/execution.entity';

@Injectable()
export class RelationshipModifyProcessor implements ExecutionProcessor {
  private readonly TASK_TYPE = 'relationship-modify';

  canProcess(taskType: string): boolean {
    return taskType === this.TASK_TYPE;
  }

  async process(execution: ExecutionEntity): Promise<any> {
    const success = execution.result['success'] as boolean;
    const action = execution.result['action'] as string;
    const requestId = execution.payload['requestId'] as string | undefined;

    return {
      success: true,
      publication: {
        socketEvent: 'relationshipModifyResponse',
        payload: { success, action, requestId },
      },
    };
  }
}

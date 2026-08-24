import { Injectable } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { ExecutionEntity } from 'src/execution/execution.entity';

@Injectable()
export class RelationshipQueryProcessor implements ExecutionProcessor {
  private readonly TASK_TYPE = 'relationship-query';

  canProcess(taskType: string): boolean {
    return taskType === this.TASK_TYPE;
  }

  async process(execution: ExecutionEntity): Promise<any> {
    const entities = execution.result['entities'] || [];
    const relationships = execution.result['relationships'] || [];
    const requestId = execution.payload['requestId'] as string | undefined;

    return {
      success: true,
      publication: {
        socketEvent: 'relationshipQueryResponse',
        payload: { entities, relationships, requestId },
      },
    };
  }
}

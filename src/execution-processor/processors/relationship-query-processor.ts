import { Injectable, Logger } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { NotificationGateway } from 'src/notification/notification.gateway';
import { ExecutionEntity } from 'src/execution/execution.entity';

@Injectable()
export class RelationshipQueryProcessor implements ExecutionProcessor {
  private readonly logger = new Logger(RelationshipQueryProcessor.name);
  private readonly TASK_TYPE = 'relationship-query';

  constructor(private readonly notificationGateway: NotificationGateway) {}

  canProcess(taskType: string): boolean {
    return taskType === this.TASK_TYPE;
  }

  async process(execution: ExecutionEntity): Promise<any> {
    const entities = execution.result['entities'] || [];
    const relationships = execution.result['relationships'] || [];
    const requestId = execution.payload['requestId'] as string | undefined;

    this.notificationGateway.sendRelationshipQueryResponse({
      entities,
      relationships,
      requestId,
    });

    return {
      success: true,
    };
  }
}

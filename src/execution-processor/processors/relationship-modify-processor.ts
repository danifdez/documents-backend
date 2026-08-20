import { Injectable, Logger } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { NotificationGateway } from 'src/notification/notification.gateway';
import { ExecutionEntity } from 'src/execution/execution.entity';

@Injectable()
export class RelationshipModifyProcessor implements ExecutionProcessor {
  private readonly logger = new Logger(RelationshipModifyProcessor.name);
  private readonly TASK_TYPE = 'relationship-modify';

  constructor(private readonly notificationGateway: NotificationGateway) {}

  canProcess(taskType: string): boolean {
    return taskType === this.TASK_TYPE;
  }

  async process(execution: ExecutionEntity): Promise<any> {
    const success = execution.result['success'] as boolean;
    const action = execution.result['action'] as string;
    const requestId = execution.payload['requestId'] as string | undefined;

    this.notificationGateway.sendRelationshipModifyResponse({
      success,
      action,
      requestId,
    });

    return {
      success: true,
    };
  }
}

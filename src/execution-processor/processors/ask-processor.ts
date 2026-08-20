import { Injectable, Logger } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { NotificationGateway } from 'src/notification/notification.gateway';
import { ExecutionEntity } from 'src/execution/execution.entity';

@Injectable()
export class AskProcessor implements ExecutionProcessor {
  private readonly logger = new Logger(AskProcessor.name);
  private readonly TASK_TYPE = 'ask';

  constructor(private readonly notificationGateway: NotificationGateway) {}

  canProcess(taskType: string): boolean {
    return taskType === this.TASK_TYPE;
  }

  async process(execution: ExecutionEntity): Promise<any> {
    const response = execution.result['response'] as string;
    const requestId = execution.payload['requestId'] as string | undefined;

    this.notificationGateway.sendAskResponse({
      response,
      requestId,
    });

    return {
      success: true,
    };
  }
}

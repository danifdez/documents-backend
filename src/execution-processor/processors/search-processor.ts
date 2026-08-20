import { Injectable, Logger } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { NotificationGateway } from 'src/notification/notification.gateway';
import { ExecutionEntity } from 'src/execution/execution.entity';

@Injectable()
export class SearchProcessor implements ExecutionProcessor {
  private readonly logger = new Logger(SearchProcessor.name);
  private readonly TASK_TYPE = 'search';

  constructor(private readonly notificationGateway: NotificationGateway) {}

  canProcess(taskType: string): boolean {
    return taskType === this.TASK_TYPE;
  }

  async process(execution: ExecutionEntity): Promise<any> {
    const results = execution.result['results'] as any[];
    const requestId = execution.payload['requestId'] as string | undefined;

    this.notificationGateway.sendSearchResponse({
      results,
      requestId,
    });

    return {
      success: true,
    };
  }
}

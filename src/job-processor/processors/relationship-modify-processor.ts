import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { NotificationGateway } from 'src/notification/notification.gateway';
import { JobEntity } from 'src/job/job.entity';

@Injectable()
export class RelationshipModifyProcessor implements JobProcessor {
  private readonly logger = new Logger(RelationshipModifyProcessor.name);
  private readonly JOB_TYPE = 'relationship-modify';

  constructor(private readonly notificationGateway: NotificationGateway) {}

  canProcess(jobType: string): boolean {
    return jobType === this.JOB_TYPE;
  }

  async process(job: JobEntity): Promise<any> {
    const success = job.result['success'] as boolean;
    const action = job.result['action'] as string;
    const requestId = job.payload['requestId'] as string | undefined;

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

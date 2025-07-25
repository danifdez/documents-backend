import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { Job } from 'src/job/job.interface';
import { NotificationGateway } from 'src/notification/notification.gateway';

@Injectable()
export class IngestContentProcessor implements JobProcessor {
  private readonly logger = new Logger(IngestContentProcessor.name);
  private readonly JOB_TYPE = 'ingest-content';

  constructor(private readonly notificationGateway: NotificationGateway) { }

  canProcess(jobType: string): boolean {
    return jobType === this.JOB_TYPE;
  }

  async process(job: Job): Promise<any> {
    const resourceId = job.payload['resourceId'] as string;

    this.notificationGateway.sendNotification({
      type: 'ingest-content',
      message: `Document ingestion completed for resource with ID ${resourceId}`,
      resourceId,
    });
  }
}

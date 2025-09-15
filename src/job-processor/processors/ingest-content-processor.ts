import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { NotificationGateway } from 'src/notification/notification.gateway';
import { JobEntity } from 'src/job/job.entity';

@Injectable()
export class IngestContentProcessor implements JobProcessor {
  private readonly logger = new Logger(IngestContentProcessor.name);
  private readonly JOB_TYPE = 'ingest-content';

  constructor(private readonly notificationGateway: NotificationGateway) {}

  canProcess(jobType: string): boolean {
    return jobType === this.JOB_TYPE;
  }

  async process(job: JobEntity): Promise<any> {
    const resourceId = Number(job.payload['resourceId']) as number;

    this.notificationGateway.sendNotification({
      type: 'ingest-content',
      message: `Document ingestion completed for resource with ID ${resourceId}`,
      resourceId,
    });
  }
}

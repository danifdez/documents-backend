import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { NotificationGateway } from 'src/notification/notification.gateway';
import { JobEntity } from 'src/job/job.entity';

@Injectable()
export class SearchProcessor implements JobProcessor {
  private readonly logger = new Logger(SearchProcessor.name);
  private readonly JOB_TYPE = 'search';

  constructor(private readonly notificationGateway: NotificationGateway) { }

  canProcess(jobType: string): boolean {
    return jobType === this.JOB_TYPE;
  }

  async process(job: JobEntity): Promise<any> {
    const results = job.result['results'] as any[];
    const requestId = job.payload['requestId'] as string | undefined;

    this.notificationGateway.sendSearchResponse({
      results,
      requestId,
    });

    return {
      success: true,
    };
  }
}

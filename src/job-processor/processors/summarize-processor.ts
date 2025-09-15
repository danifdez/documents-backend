import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { ResourceService } from 'src/resource/resource.service';
import { NotificationGateway } from 'src/notification/notification.gateway';
import { JobEntity } from 'src/job/job.entity';

@Injectable()
export class SummarizeProcessor implements JobProcessor {
  private readonly logger = new Logger(SummarizeProcessor.name);
  private readonly JOB_TYPE = 'summarize';

  constructor(
    private readonly resourceService: ResourceService,
    private readonly notificationGateway: NotificationGateway,
  ) {}

  canProcess(jobType: string): boolean {
    return jobType === this.JOB_TYPE;
  }

  async process(job: JobEntity): Promise<any> {
    const resourceId = Number(job.payload['resourceId']) as number;
    const result = job.result as { response: string };

    await this.resourceService.update(resourceId, {
      summary: result.response,
    });

    this.notificationGateway.sendNotification({
      type: 'summarization',
      message: `Document summarization completed for resource`,
      resourceId,
    });

    return {
      success: true,
      message: 'Summarization processed',
    };
  }
}

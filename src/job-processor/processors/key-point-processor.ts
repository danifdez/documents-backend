import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { ResourceService } from 'src/resource/resource.service';
import { NotificationGateway } from 'src/notification/notification.gateway';
import { JobEntity } from 'src/job/job.entity';

@Injectable()
export class KeyPointProcessor implements JobProcessor {
  private readonly logger = new Logger(KeyPointProcessor.name);
  private readonly JOB_TYPE = 'key_points';

  constructor(
    private readonly resourceService: ResourceService,
    private readonly notificationGateway: NotificationGateway,
  ) { }

  canProcess(jobType: string): boolean {
    return jobType === this.JOB_TYPE;
  }

  async process(job: JobEntity): Promise<any> {
    const resourceId = Number(job.payload['resourceId']) as number;
    const result = job.result as { data: { response: string[] } };

    await this.resourceService.update(resourceId, {
      key_points: result.data?.response,
    });

    this.notificationGateway.sendNotification({
      type: 'key_points',
      message: `Key points extraction completed for resource`,
      resourceId,
    });

    return {
      success: true,
      message: 'Key points processed',
    };
  }
}

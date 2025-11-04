import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { ResourceService } from 'src/resource/resource.service';
import { NotificationGateway } from 'src/notification/notification.gateway';
import { JobEntity } from 'src/job/job.entity';

@Injectable()
export class KeyPointsProcessor implements JobProcessor {
  private readonly logger = new Logger(KeyPointsProcessor.name);
  private readonly JOB_TYPE = 'key-point';

  constructor(
    private readonly resourceService: ResourceService,
    private readonly notificationGateway: NotificationGateway,
  ) { }

  canProcess(jobType: string): boolean {
    return jobType === this.JOB_TYPE;
  }

  async process(job: JobEntity): Promise<any> {
    const resourceId = job.payload['resourceId'] ? Number(job.payload['resourceId']) : null;
    const result = job.result as { key_points: string[] };

    if (resourceId && result && Array.isArray(result.key_points)) {
      try {
        await this.resourceService.update(resourceId, {
          keyPoints: result.key_points,
        });

        this.notificationGateway.sendNotification({
          type: 'key-points',
          message: `Key points extracted for resource ${resourceId}`,
          resourceId: resourceId,
        });
      } catch (err) {
        this.logger.error('Failed to update resource with key points', err);
      }
    } else {
      this.logger.warn('KeyPointsProcessor: Invalid job result or missing resourceId');
    }

    return {
      success: true,
      message: 'Key points processed',
    };
  }
}

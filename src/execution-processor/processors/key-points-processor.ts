import { Injectable, Logger } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { ResourceService } from 'src/resource/resource.service';
import { NotificationGateway } from 'src/notification/notification.gateway';
import { ExecutionEntity } from 'src/execution/execution.entity';

@Injectable()
export class KeyPointsProcessor implements ExecutionProcessor {
  private readonly logger = new Logger(KeyPointsProcessor.name);
  private readonly TASK_TYPE = 'key-point';

  constructor(
    private readonly resourceService: ResourceService,
    private readonly notificationGateway: NotificationGateway,
  ) {}

  canProcess(taskType: string): boolean {
    return taskType === this.TASK_TYPE;
  }

  async process(execution: ExecutionEntity): Promise<any> {
    const resourceId = execution.payload['resourceId']
      ? Number(execution.payload['resourceId'])
      : null;
    const result = execution.result as {
      key_points?: string[];
      error?: string;
    };

    if (result?.error) {
      this.logger.warn(
        `Key-points execution ${execution.executionId} returned error: ${result.error}`,
      );
      this.notificationGateway.sendNotification({
        type: 'key-points',
        message: `Key points extraction failed: ${result.error}`,
        resourceId: resourceId ?? undefined,
      });
      return { success: false, message: result.error };
    }

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
      this.logger.warn(
        'KeyPointsProcessor: Invalid execution result or missing resourceId',
      );
    }

    return {
      success: true,
      message: 'Key points processed',
    };
  }
}

import { Injectable } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { ResourceService } from '../../resource/resource.service';
import { ExecutionEntity } from '../../execution/execution.entity';

@Injectable()
export class KeyPointsProcessor implements ExecutionProcessor {
  private readonly TASK_TYPE = 'key-point';

  constructor(private readonly resourceService: ResourceService) {}

  canProcess(taskType: string): boolean {
    return taskType === this.TASK_TYPE;
  }

  async process(execution: ExecutionEntity): Promise<any> {
    const resourceId = Number(execution.payload['resourceId']);
    const result = execution.result as { key_points?: unknown };
    if (!Number.isInteger(resourceId) || resourceId <= 0) {
      throw new Error('Key-point execution requires a valid resourceId');
    }
    if (
      !result ||
      !Array.isArray(result.key_points) ||
      result.key_points.some((point) => typeof point !== 'string')
    ) {
      throw new Error('Key-point execution returned an invalid result');
    }

    await this.resourceService.update(resourceId, {
      keyPoints: result.key_points,
    });

    return {
      success: true,
      message: 'Key points processed',
      publication: {
        socketEvent: 'notification',
        payload: {
          type: 'key-points',
          message: `Key points extracted for resource ${resourceId}`,
          resourceId,
        },
      },
    };
  }
}

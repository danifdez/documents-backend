import { Injectable } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { ResourceService } from '../../resource/resource.service';
import { ExecutionEntity } from '../../execution/execution.entity';

@Injectable()
export class KeywordsProcessor implements ExecutionProcessor {
  private readonly TASK_TYPE = 'keywords';

  constructor(private readonly resourceService: ResourceService) {}

  canProcess(taskType: string): boolean {
    return taskType === this.TASK_TYPE;
  }

  async process(execution: ExecutionEntity): Promise<any> {
    const resourceId = Number(execution.payload['resourceId']);
    const result = execution.result as { keywords?: unknown };
    if (!Number.isInteger(resourceId) || resourceId <= 0) {
      throw new Error('Keywords execution requires a valid resourceId');
    }
    if (
      !result ||
      !Array.isArray(result.keywords) ||
      result.keywords.some((keyword) => typeof keyword !== 'string')
    ) {
      throw new Error('Keywords execution returned an invalid result');
    }

    await this.resourceService.update(resourceId, {
      keywords: result.keywords,
    });

    return {
      success: true,
      message: 'Keywords processed',
      publication: {
        socketEvent: 'notification',
        payload: {
          type: 'keywords',
          message: `Keywords extracted for resource ${resourceId}`,
          resourceId,
        },
      },
    };
  }
}

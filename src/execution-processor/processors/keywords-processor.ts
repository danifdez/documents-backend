import { Injectable, Logger } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { ResourceService } from 'src/resource/resource.service';
import { ExecutionEntity } from 'src/execution/execution.entity';

@Injectable()
export class KeywordsProcessor implements ExecutionProcessor {
  private readonly logger = new Logger(KeywordsProcessor.name);
  private readonly TASK_TYPE = 'keywords';

  constructor(private readonly resourceService: ResourceService) {}

  canProcess(taskType: string): boolean {
    return taskType === this.TASK_TYPE;
  }

  async process(execution: ExecutionEntity): Promise<any> {
    const resourceId = execution.payload['resourceId']
      ? Number(execution.payload['resourceId'])
      : null;
    const result = execution.result as { keywords?: string[]; error?: string };

    if (result?.error) {
      this.logger.warn(
        `Keywords execution ${execution.executionId} returned error: ${result.error}`,
      );
      return {
        success: false,
        message: result.error,
        publication: {
          socketEvent: 'notification',
          payload: {
            type: 'keywords',
            message: `Keywords extraction failed: ${result.error}`,
            resourceId: resourceId ?? undefined,
          },
        },
      };
    }

    if (resourceId && result && Array.isArray(result.keywords)) {
      try {
        await this.resourceService.update(resourceId, {
          keywords: result.keywords,
        });
      } catch (err) {
        this.logger.error('Failed to update resource with keywords', err);
      }
    } else {
      this.logger.warn(
        'KeywordsProcessor: Invalid execution result or missing resourceId',
      );
    }

    return {
      success: true,
      message: 'Keywords processed',
      publication: {
        socketEvent: 'notification',
        payload: {
          type: 'keywords',
          message: `Keywords extracted for resource ${resourceId}`,
          resourceId: resourceId ?? undefined,
        },
      },
    };
  }
}

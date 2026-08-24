import { Injectable, Logger } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { ResourceService } from 'src/resource/resource.service';
import { ExecutionEntity } from 'src/execution/execution.entity';
import { DocService } from 'src/doc/doc.service';

@Injectable()
export class SummarizeProcessor implements ExecutionProcessor {
  private readonly logger = new Logger(SummarizeProcessor.name);
  private readonly TASK_TYPE = 'summarize';

  constructor(
    private readonly resourceService: ResourceService,
    private readonly docService: DocService,
  ) {}

  canProcess(taskType: string): boolean {
    return taskType === this.TASK_TYPE;
  }

  async process(execution: ExecutionEntity): Promise<any> {
    const resourceId = execution.payload['resourceId']
      ? Number(execution.payload['resourceId'])
      : null;
    const targetDocId = execution.payload['targetDocId']
      ? Number(execution.payload['targetDocId'])
      : null;
    const result = execution.result as { response?: string; error?: string };

    if (result?.error) {
      this.logger.warn(
        `Summarization execution ${execution.executionId} returned error: ${result.error}`,
      );
      return {
        success: false,
        message: result.error,
        publication: {
          socketEvent: 'notification',
          payload: {
            type: 'summarization',
            message: `Document summarization failed: ${result.error}`,
            resourceId: resourceId ?? undefined,
            docId: targetDocId ?? undefined,
          },
        },
      };
    }

    const summary = result?.response ?? '';

    let message: string;
    if (targetDocId) {
      const doc = await this.docService.findOne(targetDocId);
      if (!doc) {
        return {
          success: false,
          message: `Target document ${targetDocId} not found`,
        };
      }
      const existing = doc.content || '';
      await this.docService.update(targetDocId, {
        content: `${existing}\n\n${summary}`,
      });
      message = 'Document summarization appended to workspace document';
    } else {
      if (resourceId) {
        await this.resourceService.update(resourceId, {
          summary,
        });
      }

      message = `Document summarization completed${resourceId ? ' for resource' : ''}`;
    }

    return {
      success: true,
      message: 'Summarization processed',
      publication: {
        socketEvent: 'notification',
        payload: {
          type: 'summarization',
          message,
          resourceId: resourceId ?? undefined,
          docId: targetDocId ?? undefined,
        },
      },
    };
  }
}

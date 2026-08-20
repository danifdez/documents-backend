import { Injectable, Logger } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { ResourceService } from 'src/resource/resource.service';
import { NotificationGateway } from 'src/notification/notification.gateway';
import { ExecutionEntity } from 'src/execution/execution.entity';
import { DocService } from 'src/doc/doc.service';

@Injectable()
export class SummarizeProcessor implements ExecutionProcessor {
  private readonly logger = new Logger(SummarizeProcessor.name);
  private readonly TASK_TYPE = 'summarize';

  constructor(
    private readonly resourceService: ResourceService,
    private readonly notificationGateway: NotificationGateway,
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
      this.notificationGateway.sendNotification({
        type: 'summarization',
        message: `Document summarization failed: ${result.error}`,
        resourceId: resourceId ?? undefined,
        docId: targetDocId ?? undefined,
      });
      return { success: false, message: result.error };
    }

    const summary = result?.response ?? '';

    // If a targetDocId is provided, append the summary to the workspace document content
    if (targetDocId) {
      try {
        const doc = await this.docService.findOne(targetDocId);
        if (doc) {
          const existing = doc.content || '';
          const appended = existing + '\n\n' + summary;
          await this.docService.update(targetDocId, { content: appended });

          this.notificationGateway.sendNotification({
            type: 'summarization',
            message: `Document summarization appended to workspace document`,
            resourceId: resourceId ?? undefined,
            docId: targetDocId,
          });
        }
      } catch (err) {
        this.logger.error(
          'Failed to append summary to workspace document',
          err,
        );
      }
    } else {
      if (resourceId) {
        await this.resourceService.update(resourceId, {
          summary,
        });
      }

      this.notificationGateway.sendNotification({
        type: 'summarization',
        message: `Document summarization completed${resourceId ? ' for resource' : ''}`,
        resourceId: resourceId ?? undefined,
      });
    }

    return {
      success: true,
      message: 'Summarization processed',
    };
  }
}

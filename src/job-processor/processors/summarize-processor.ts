import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { ResourceService } from 'src/resource/resource.service';
import { NotificationGateway } from 'src/notification/notification.gateway';
import { JobEntity } from 'src/job/job.entity';
import { DocService } from 'src/doc/doc.service';

@Injectable()
export class SummarizeProcessor implements JobProcessor {
  private readonly logger = new Logger(SummarizeProcessor.name);
  private readonly JOB_TYPE = 'summarize';

  constructor(
    private readonly resourceService: ResourceService,
    private readonly notificationGateway: NotificationGateway,
    private readonly docService: DocService,
  ) { }

  canProcess(jobType: string): boolean {
    return jobType === this.JOB_TYPE;
  }

  async process(job: JobEntity): Promise<any> {
    const resourceId = job.payload['resourceId'] ? Number(job.payload['resourceId']) : null;
    const targetDocId = job.payload['targetDocId'] ? Number(job.payload['targetDocId']) : null;
    const result = job.result as { response: string };

    // If a targetDocId is provided, append the summary to the workspace document content
    if (targetDocId) {
      try {
        const doc = await this.docService.findOne(targetDocId);
        if (doc) {
          const existing = doc.content || '';
          const appended = existing + '\n\n' + result.response;
          await this.docService.update(targetDocId, { content: appended });

          this.notificationGateway.sendNotification({
            type: 'summarization',
            message: `Document summarization appended to workspace document`,
            resourceId: resourceId ?? undefined,
            docId: targetDocId,
          });
        }
      } catch (err) {
        this.logger.error('Failed to append summary to workspace document', err);
      }
    } else {
      if (resourceId) {
        await this.resourceService.update(resourceId, {
          summary: result.response,
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

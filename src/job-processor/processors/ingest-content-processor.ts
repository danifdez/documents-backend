import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { NotificationGateway } from 'src/notification/notification.gateway';
import { JobEntity } from 'src/job/job.entity';
import { ResourceService } from 'src/resource/resource.service';

@Injectable()
export class IngestContentProcessor implements JobProcessor {
  private readonly logger = new Logger(IngestContentProcessor.name);
  private readonly JOB_TYPE = 'ingest-content';

  constructor(
    private readonly notificationGateway: NotificationGateway,
    private readonly resourceService: ResourceService,
  ) { }

  canProcess(jobType: string): boolean {
    return jobType === this.JOB_TYPE;
  }

  async process(job: JobEntity): Promise<any> {
    const sourceType = job.payload['sourceType'] || 'resource';

    if (sourceType === 'resource') {
      const resourceId = Number(job.payload['resourceId']);
      await this.resourceService.update(resourceId, { status: 'ready' });

      this.notificationGateway.sendNotification({
        type: 'ingest-content',
        message: `Document ingestion completed for resource with ID ${resourceId}. Resource is now ready.`,
        resourceId,
      });
    } else if (sourceType === 'doc') {
      const docId = Number(job.payload['docId']);

      this.notificationGateway.sendNotification({
        type: 'ingest-content',
        message: `Document ingestion completed for doc ${docId}.`,
        docId,
      });
    } else if (sourceType === 'knowledge') {
      const knowledgeEntryId = Number(job.payload['knowledgeEntryId']);

      this.notificationGateway.sendNotification({
        type: 'ingest-content',
        message: `Knowledge base entry ${knowledgeEntryId} ingested into RAG.`,
        knowledgeEntryId,
      });
    }
  }
}

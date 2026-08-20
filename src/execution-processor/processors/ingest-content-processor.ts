import { Injectable, Logger } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { NotificationGateway } from 'src/notification/notification.gateway';
import { ExecutionEntity } from 'src/execution/execution.entity';
import { ResourceService } from 'src/resource/resource.service';

@Injectable()
export class IngestContentProcessor implements ExecutionProcessor {
  private readonly logger = new Logger(IngestContentProcessor.name);
  private readonly TASK_TYPE = 'ingest-content';

  constructor(
    private readonly notificationGateway: NotificationGateway,
    private readonly resourceService: ResourceService,
  ) {}

  canProcess(taskType: string): boolean {
    return taskType === this.TASK_TYPE;
  }

  async process(execution: ExecutionEntity): Promise<any> {
    const sourceType = execution.payload['sourceType'] || 'resource';

    if (sourceType === 'resource') {
      const resourceId = Number(execution.payload['resourceId']);
      await this.resourceService.update(resourceId, { status: 'ready' });

      this.notificationGateway.sendNotification({
        type: 'ingest-content',
        message: `Document ingestion completed for resource with ID ${resourceId}. Resource is now ready.`,
        resourceId,
      });
    } else if (sourceType === 'doc') {
      const docId = Number(execution.payload['docId']);

      this.notificationGateway.sendNotification({
        type: 'ingest-content',
        message: `Document ingestion completed for doc ${docId}.`,
        docId,
      });
    } else if (sourceType === 'knowledge') {
      const knowledgeEntryId = Number(execution.payload['knowledgeEntryId']);

      this.notificationGateway.sendNotification({
        type: 'ingest-content',
        message: `Knowledge base entry ${knowledgeEntryId} ingested into RAG.`,
        knowledgeEntryId,
      });
    }
  }
}

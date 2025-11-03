import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { JobPriority } from 'src/job/job-priority.enum';
import { ResourceService } from 'src/resource/resource.service';
import { NotificationGateway } from 'src/notification/notification.gateway';
import { JobService } from 'src/job/job.service';
import { JobEntity } from 'src/job/job.entity';

@Injectable()
export class DocumentExtractionProcessor implements JobProcessor {
  private readonly logger = new Logger(DocumentExtractionProcessor.name);
  private readonly JOB_TYPE = 'document-extraction';

  constructor(
    private readonly resourceService: ResourceService,
    private readonly notificationGateway: NotificationGateway,
  ) { }

  canProcess(jobType: string): boolean {
    return jobType === this.JOB_TYPE;
  }

  async process(job: JobEntity): Promise<any> {
    const hash = job.payload['hash'] as string;
    const extension = job.payload['extension'] as string;
    const resourceId = Number(job.payload['resourceId']) as number;
    const result = job.result as {
      title: string;
      author: string;
      publication_date: Date;
      content: string;
      pages?: number;
    };

    if (!hash || !extension || !resourceId || !result) {
      throw new Error(
        'Job payload missing required parameters (hash, extension, resourceId, or result)',
      );
    }

    const { title, author, publication_date, content, pages } = result;

    const updateData: any = {
      title,
      author,
      publicationDate: publication_date,
      content,
      confirmationStatus: 'pending',
    };

    if (pages !== undefined) {
      updateData.pages = pages;
    }

    await this.resourceService.update(resourceId, updateData);

    this.notificationGateway.sendNotification({
      type: 'document-extraction',
      message: `Document extraction completed for resource with hash ${hash}. Pending confirmation.`,
      resourceId,
    });

    return { success: true, resourceId, status: 'pending_confirmation' };
  }
}

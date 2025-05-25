import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { FileStorageService } from 'src/file-storage/file-storage.service';
import { Job } from 'src/job/job.interface';
import { ResourceService } from 'src/resource/resource.service';
import { NotificationGateway } from 'src/notification/notification.gateway';
import { JobService } from 'src/job/job.service';
import { JobProcessorClientService } from '../job-processor-client.service';

@Injectable()
export class DocumentExtractionProcessor implements JobProcessor {
  private readonly logger = new Logger(DocumentExtractionProcessor.name);
  private readonly JOB_TYPE = 'document-extraction';

  constructor(
    private readonly fileService: FileStorageService,
    private readonly resourceService: ResourceService,
    private readonly notificationGateway: NotificationGateway,
    private readonly jobService: JobService,
    private readonly jobProcessorClientService: JobProcessorClientService,
  ) { }

  canProcess(jobType: string): boolean {
    return jobType === this.JOB_TYPE;
  }

  async process(job: Job): Promise<any> {
    const hash = job.payload['hash'] as string;
    const extension = job.payload['extension'] as string;

    if (!hash || !extension) {
      throw new Error('Job payload missing required parameters (hash or extension)');
    }

    const fullPath = this.fileService.getFullPath(hash, extension);

    const extractedContent = await this.extractDocument(fullPath);

    if (extractedContent.error) {
      throw new Error(`Extraction failed: ${extractedContent.error}`);
    }

    const resource = await this.resourceService.findByHash(hash);
    if (!resource) {
      throw new Error(`Resource with hash ${hash} not found`);
    }

    await this.resourceService.update(resource._id.toString(), {
      content: extractedContent.content,
    });

    this.notificationGateway.sendNotification({
      type: 'document-extraction',
      message: `Document extraction completed for resource with hash ${hash}`,
      resourceId: resource._id,
    });

    this.jobService.create('detect-language', {
      resourceId: resource._id.toString(),
    });

    return { success: true, resourceId: resource._id };
  }

  private async extractDocument(filePath: string): Promise<any> {
    return await this.jobProcessorClientService.post('extraction', { file: filePath });
  }
}

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
    private readonly jobService: JobService,
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
    };

    if (!hash || !extension || !resourceId || !result) {
      throw new Error(
        'Job payload missing required parameters (hash, extension, resourceId, or result)',
      );
    }

    const { title, author, publication_date, content } = result;

    await this.resourceService.update(resourceId, {
      title,
      author,
      publicationDate: publication_date,
      content,
    });

    this.notificationGateway.sendNotification({
      type: 'document-extraction',
      message: `Document extraction completed for resource with hash ${hash}`,
      resourceId,
    });

    const samples = this.extractTextSamples(content);

    this.jobService.create('detect-language', JobPriority.NORMAL, {
      resourceId,
      samples,
    });

    return { success: true, resourceId };
  }

  private extractTextSamples(html: string): string[] {
    try {
      const fullText = html
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const samples: string[] = [];

      if (fullText.length <= 400) {
        const midpoint = Math.floor(fullText.length / 2);
        samples.push(fullText.substring(0, Math.min(200, midpoint)).trim());
        samples.push(
          fullText
            .substring(
              midpoint,
              midpoint + Math.min(200, fullText.length - midpoint),
            )
            .trim(),
        );
      } else {
        for (let i = 0; i < 2; i++) {
          const maxStart = fullText.length - 200;
          const start = Math.floor(Math.random() * maxStart);
          const end = Math.min(start + 200, fullText.length);
          samples.push(fullText.substring(start, end).trim());
        }
      }

      return samples;
    } catch (error) {
      this.logger.error(`Error extracting text samples: ${error.message}`);
      return [];
    }
  }
}

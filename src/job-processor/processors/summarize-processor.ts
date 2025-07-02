import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { Job } from 'src/job/job.interface';
import { ResourceService } from 'src/resource/resource.service';
import { RagClientService } from 'src/rag/rag-client.service';
import { NotificationGateway } from 'src/notification/notification.gateway';

@Injectable()
export class SummarizeProcessor implements JobProcessor {
  private readonly logger = new Logger(SummarizeProcessor.name);
  private readonly JOB_TYPE = 'summarize';

  constructor(
    private readonly resourceService: ResourceService,
    private readonly ragClientService: RagClientService,
    private readonly notificationGateway: NotificationGateway,
  ) { }

  canProcess(jobType: string): boolean {
    return jobType === this.JOB_TYPE;
  }

  async process(job: Job): Promise<any> {
    const resourceId = job.payload['resourceId'] as string;
    const sourceLanguage = job.payload['sourceLanguage'] as string;
    const targetLanguage = job.payload['targetLanguage'] as string;
    const content = job.payload['content'] as string;

    const result = await this.ragClientService.post('summarize', {
      text: content,
      source_language: sourceLanguage,
      target_language: targetLanguage,
    });

    console.log('Summarization result:', result);

    await this.resourceService.update(resourceId, {
      summary: result.response,
    });

    this.notificationGateway.sendNotification({
      type: 'summarization',
      message: `Document summarization completed for resource`,
      resourceId,
    });

    return {
      success: true,
      message: 'Summarization processed',
    };
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { ResourceService } from 'src/resource/resource.service';
import { JobService } from 'src/job/job.service';
import { JobPriority } from 'src/job/job-priority.enum';
import { JobEntity } from 'src/job/job.entity';
import { extractTextFromHtml } from 'src/utils/text';

@Injectable()
export class DetectLanguageProcessor implements JobProcessor {
  private readonly logger = new Logger(DetectLanguageProcessor.name);
  private readonly JOB_TYPE = 'detect-language';

  constructor(
    private readonly resourceService: ResourceService,
    private readonly jobService: JobService,
  ) {}

  canProcess(jobType: string): boolean {
    return jobType === this.JOB_TYPE;
  }

  async process(job: JobEntity): Promise<any> {
    const resourceId = Number(job.payload['resourceId']) as number;
    const results = (job.result as { results: { language: string }[] }).results;

    if (
      results[0].language !== 'unknown' &&
      results[0].language === results[1].language
    ) {
      const detectedLanguage = results[0].language;
      const resource = await this.resourceService.findOne(resourceId);
      const content = await this.resourceService.getContentById(resourceId);
      const projectId = (resource?.project as any)?.id || null;

      if (!content) {
        await this.resourceService.update(resourceId, {
          language: detectedLanguage,
          status: 'ready',
        });
        return;
      }

      if (detectedLanguage === 'en') {
        // English: set workingContent = content and ingest immediately
        await this.resourceService.update(resourceId, {
          language: detectedLanguage,
          workingContent: content,
          status: 'ready',
        });

        await this.jobService.create('ingest-content', JobPriority.NORMAL, {
          resourceId,
          projectId,
          content,
        });
      } else {
        // Non-English: translate content to English, save to workingContent, then ingest
        await this.resourceService.update(resourceId, {
          language: detectedLanguage,
          status: 'ready',
        });

        const extractedTexts = extractTextFromHtml(content);
        await this.jobService.create('translate', JobPriority.NORMAL, {
          translationType: 'content',
          resourceId,
          sourceLanguage: detectedLanguage,
          targetLanguage: 'en',
          saveTo: 'workingContent',
          triggerIngest: true,
          texts: extractedTexts,
        });
      }
    }
  }
}

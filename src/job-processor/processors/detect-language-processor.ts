import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { JobPriority } from 'src/job/job-priority.enum';
import { ResourceService } from 'src/resource/resource.service';
import { JobService } from 'src/job/job.service';
import { extractTextFromHtml } from 'src/utils/text';
import { JobEntity } from 'src/job/job.entity';

@Injectable()
export class DetectLanguageProcessor implements JobProcessor {
  private readonly logger = new Logger(DetectLanguageProcessor.name);
  private readonly JOB_TYPE = 'detect-language';

  constructor(
    private readonly resourceService: ResourceService,
    private readonly jobService: JobService,
  ) { }

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
      this.resourceService.update(resourceId, {
        language: results[0].language,
      });

      const resource = await this.resourceService.findOne(resourceId);
      const content = await this.resourceService.getContentById(resourceId);
      const extractedTexts = extractTextFromHtml(content);

      if (results[0].language !== 'en') {
        this.jobService.create('translate', JobPriority.NORMAL, {
          resourceId: resourceId,
          sourceLanguage: results[0].language,
          targetLanguage: 'en',
          saveTo: 'workingContent',
          texts: extractedTexts,
        });
      } else {
        this.jobService.create('ingest-content', JobPriority.NORMAL, {
          resourceId: resourceId,
          projectId: resource.project,
          content: content,
        });
      }
    }
  }
}

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
      const detectedLanguage = results[0].language;

      await this.resourceService.update(resourceId, {
        language: detectedLanguage,
      });

      const resource = await this.resourceService.findOne(resourceId);
      const content = await this.resourceService.getContentById(resourceId);
      const extractedTexts = extractTextFromHtml(content);

      // TODO: Get default language from settings (hardcoded to 'en' for now)
      const defaultLanguage = 'es';

      // If detected language is the same as default language, go directly to entities
      if (detectedLanguage === defaultLanguage) {
        await this.resourceService.update(resourceId, {
          status: 'entities',
        });

        // Launch entity extraction job with texts array
        await this.jobService.create('entity-extraction', JobPriority.NORMAL, {
          resourceId: resourceId,
          texts: extractedTexts,
        });
      } else {
        // If language is different, translate first
        await this.resourceService.update(resourceId, { status: 'translating' });

        await this.jobService.create('translate', JobPriority.NORMAL, {
          resourceId: resourceId,
          sourceLanguage: detectedLanguage,
          targetLanguage: defaultLanguage,
          saveTo: 'translatedContent',
          texts: extractedTexts,
        });
      }
    }
  }
}

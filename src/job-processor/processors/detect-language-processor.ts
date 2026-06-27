import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { ResourceService } from 'src/resource/resource.service';
import { JobService } from 'src/job/job.service';
import { JobPriority } from 'src/job/job-priority.enum';
import { JobEntity } from 'src/job/job.entity';

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

      // Original language is preserved — no translation. The content is ingested
      // as-is (multilingual embedding) and dates are extracted in the document's
      // own language.
      await this.resourceService.update(resourceId, {
        language: detectedLanguage,
        status: 'ready',
      });

      await this.jobService.create('ingest-content', JobPriority.NORMAL, {
        resourceId,
        projectId,
        content,
      });

      const anchorDate = resource?.publicationDate
        ? String(resource.publicationDate).slice(0, 10)
        : null;
      await this.jobService.create('date-extraction', JobPriority.NORMAL, {
        resourceId,
        text: content,
        language: detectedLanguage,
        anchorDate,
      });
    }
  }
}

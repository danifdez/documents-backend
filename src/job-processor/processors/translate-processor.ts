import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { Job, JobPriority } from 'src/job/job.interface';
import { ResourceService } from 'src/resource/resource.service';
import * as cheerio from 'cheerio';
import { JobService } from 'src/job/job.service';

@Injectable()
export class TranslateProcessor implements JobProcessor {
  private readonly logger = new Logger(TranslateProcessor.name);
  private readonly JOB_TYPE = 'translate';

  constructor(
    private readonly resourceService: ResourceService,
    private readonly jobService: JobService,
  ) { }

  canProcess(jobType: string): boolean {
    return jobType === this.JOB_TYPE;
  }

  async process(job: Job): Promise<any> {
    const resourceId = job.payload['resourceId'] as string;
    const saveTo = job.payload['saveTo'] || 'translatedContent';
    const results = job.result as {
      response: Array<{
        path: string;
        original_text: string;
        translation_text: string;
      }>;
    };

    const resource = await this.resourceService.findOne(resourceId);

    const translatedHtml = this.updateHtmlWithTranslations(
      resource.content,
      results.response,
    );

    const $ = cheerio.load(translatedHtml);
    const bodyContent = $('body').html() || translatedHtml;

    await this.resourceService.update(resourceId, {
      [saveTo]: bodyContent,
    });

    if (
      job.payload['saveTo'] === 'workingContent' &&
      job.payload['targetLanguage'] === 'en'
    ) {
      this.jobService.create('entity-extraction', JobPriority.NORMAL, {
        resourceId: resourceId,
        from: 'content',
        texts: results.response.map((item) => ({
          text: item.translation_text,
        })),
      });
      this.jobService.create('ingest-content', JobPriority.NORMAL, {
        resourceId: resourceId,
        projectId: resource.project,
        content: bodyContent,
      });
    }

    return {
      success: true,
    };
  }

  /**
   * Updates HTML content with translated text
   * @param html Original HTML content
   * @param translations Array of objects with path and translated text
   * @returns Updated HTML content with translations applied
   */
  private updateHtmlWithTranslations(
    html: string,
    translations: Array<{
      path: string;
      original_text: string;
      translation_text: string;
    }>,
  ): string {
    const $ = cheerio.load(html);

    translations.forEach((item) => {
      try {
        const containerElement = item.path.includes('>')
          ? $(item.path)
          : $(`${item.path}`);

        if (containerElement.length) {
          containerElement.contents().each((_, node) => {
            if (
              node.type === 'text' &&
              $(node).text().trim() === item.original_text
            ) {
              $(node).replaceWith(item.translation_text);
            }
          });
        }
      } catch (error) {
        this.logger.error(
          `Failed to update HTML for path ${item.path}: ${error.message}`,
        );
      }
    });

    return $.html();
  }
}

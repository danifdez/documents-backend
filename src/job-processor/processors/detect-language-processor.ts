import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { Job } from 'src/job/job.interface';
import { ResourceService } from 'src/resource/resource.service';
import { JobService } from 'src/job/job.service';
import { JobProcessorClientService } from '../job-processor-client.service';

@Injectable()
export class DetectLanguageProcessor implements JobProcessor {
  private readonly logger = new Logger(DetectLanguageProcessor.name);
  private readonly JOB_TYPE = 'detect-language';

  constructor(
    private readonly resourceService: ResourceService,
    private readonly jobService: JobService,
    private readonly jobProcessorClientService: JobProcessorClientService,
  ) { }

  canProcess(jobType: string): boolean {
    return jobType === this.JOB_TYPE;
  }

  async process(job: Job): Promise<any> {
    const resourceId = job.payload['resourceId'] as string;

    const resource = await this.resourceService.findOne(resourceId);

    if (!resource && !resource?.content) {
      throw new Error(`Resource with ID ${resourceId} not found`);
    }

    const samples = this.extractTextSamples(resource.content);

    Promise.all(samples.map((sample) => this.detectLanguage(sample)))
      .then((results) => {
        if (
          results[0].language !== 'unknown' &&
          results[0].language === results[1].language
        ) {
          this.resourceService.update(resourceId, {
            language: results[0].language,
          });

          if (results[0].language === 'en') {
            this.jobService.create('entity-extraction', {
              resourceId: resourceId,
              from: 'content',
            });
            this.jobService.create('ingest-content', {
              resourceId: resourceId,
              projectId: resource.project,
              content: resource.content,
            });
          } else {
            this.jobService.create('translate', {
              resourceId: resourceId,
              sourceLanguage: results[0].language,
              targetLanguage: 'en',
              saveTo: 'workingContent',
            });
          }
          if (results[0].language !== 'es') {
            this.jobService.create('translate', {
              resourceId: resourceId,
              sourceLanguage: results[0].language,
              targetLanguage: 'es',
              saveTo: 'translatedContent',
            });
          }
        }
      })
      .catch((error) => {
        this.logger.error(`Error running Python script: ${error.message}`);
      });
  }

  /**
   * Run the Python script to detect language
   * @param sample Text sample to process
   * @returns Promise resolving to the result of the Python script
   */
  private detectLanguage(sample: string): Promise<any> {
    return this.jobProcessorClientService.post('language', { text: sample });
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
        samples.push(fullText.substring(midpoint, midpoint + Math.min(200, fullText.length - midpoint)).trim());
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

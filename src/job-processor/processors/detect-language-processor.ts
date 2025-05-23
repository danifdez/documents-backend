import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { Job } from 'src/job/job.interface';
import * as path from 'path';
import { ResourceService } from 'src/resource/resource.service';
import { spawn } from 'child_process';
import { JobService } from 'src/job/job.service';

@Injectable()
export class DetectLanguageProcessor implements JobProcessor {
  private readonly logger = new Logger(DetectLanguageProcessor.name);
  private readonly JOB_TYPE = 'detect-language';
  private readonly extractorPath = path.join(
    process.cwd(),
    'utilities/detect_language.py',
  );

  constructor(
    private readonly resourceService: ResourceService,
    private readonly jobService: JobService,
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

    Promise.all(samples.map((sample) => this.runPythonScript(sample)))
      .then((results) => {
        if (results[0] !== 'unknown' && results[0] === results[1]) {
          this.resourceService.update(resourceId, {
            language: results[0],
          });

          if (results[0] === 'en') {
            this.jobService.create('entity-extraction', {
              resourceId: resourceId,
              from: 'content',
            });
          } else {
            this.jobService.create('translate', {
              resourceId: resourceId,
              sourceLanguage: results[0],
              targetLanguage: 'en',
              saveTo: 'workingContent',
            });
          }
          if (results[0] !== 'es') {
            this.jobService.create('translate', {
              resourceId: resourceId,
              sourceLanguage: results[0],
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
  private runPythonScript(sample: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const pythonProcess = spawn('python', [this.extractorPath, sample]);
      let dataString = '';
      let errorString = '';
      pythonProcess.stdout.on('data', (data) => {
        dataString += data.toString();
      });
      pythonProcess.stderr.on('data', (data) => {
        errorString += data.toString();
        this.logger.error(`Extraction error: ${data.toString()}`);
      });
      pythonProcess.on('close', (code) => {
        if (code !== 0) {
          if (errorString) {
            this.logger.error(`Error details: ${errorString}`);
          }
          reject(new Error(`Python script exited with code ${code}`));
          return;
        }
        try {
          const trimmedResult = dataString.trim();
          if (trimmedResult) {
            resolve(trimmedResult);
          } else {
            resolve('unknown'); // Default when no language is detected
          }
        } catch (parseError) {
          this.logger.error(
            `Failed to parse extraction result: ${parseError.message}`,
          );
          reject(new Error(`Failed to parse extraction result: ${parseError.message}`));
        }
      });
      pythonProcess.on('error', (error) => {
        this.logger.error(`Failed to start Python process: ${error.message}`);
        reject(new Error(`Failed to start Python process: ${error.message}`));
      });
    });
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

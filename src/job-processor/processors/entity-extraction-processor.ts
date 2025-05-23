import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { Job } from 'src/job/job.interface';
import { ResourceService } from 'src/resource/resource.service';
import * as cheerio from 'cheerio';
import { spawn } from 'child_process';
import * as path from 'path';

@Injectable()
export class EntityExtractionProcessor implements JobProcessor {
  private readonly logger = new Logger(EntityExtractionProcessor.name);
  private readonly JOB_TYPE = 'entity-extraction';
  private readonly extractorPath = path.join(
    process.cwd(),
    'utilities/entities.py',
  );

  constructor(private readonly resourceService: ResourceService) { }

  canProcess(jobType: string): boolean {
    return jobType === this.JOB_TYPE;
  }

  async process(job: Job): Promise<any> {
    const resourceId = job.payload['resourceId'] as string;
    const from = job.payload['from'] as string;

    if (!resourceId) {
      throw new Error('Job payload missing required parameters (resourceId)');
    }

    const resource = await this.resourceService.findOne(resourceId);

    if (!resource || !resource?.content) {
      throw new Error(`Resource with ID ${resourceId} not found`);
    }

    const content = resource[from];

    const extractedTexts = this.extractTextFromHtml(content);
    this.logger.log(
      `Extracted ${extractedTexts.length} text elements from HTML`,
    );

    const translationsMap = new Map<string, { word: string; entity: string }>();

    for (let i = 0; i < extractedTexts.length; i += 32) {
      const chunk = extractedTexts.slice(i, i + 32);
      const textsToTranslate = chunk.map((item) => item.text);
      try {
        const translatedTexts = await this.runPythonScript(textsToTranslate);
        translatedTexts.forEach((translatedText) => {
          if (
            translatedText &&
            typeof translatedText === 'object' &&
            translatedText.word &&
            translatedText.entity
          ) {
            const key = `${translatedText.word}:${translatedText.entity}`;
            translationsMap.set(key, {
              word: translatedText.word,
              entity: translatedText.entity,
            });
          }
        });
        this.logger.log(
          `Processed ${translationsMap.size} translations so far`,
        );
      } catch (error) {
        this.logger.error(
          `Translation error for chunk ${i / 4}: ${error.message}`,
        );
      }
    }

    this.resourceService.update(resourceId, {
      entities: Array.from(translationsMap.values()),
    });

    return { success: true, resourceId: resource._id };
  }

  /**
   * Extracts text content from HTML tags one by one
   * @param html The HTML content to process
   * @returns Array of objects with tagName, text content, and original HTML element
   */
  private extractTextFromHtml(html: string): Array<{
    tagName: string;
    text: string;
    element: any;
    path: string;
  }> {
    const $ = cheerio.load(html);
    const results: Array<{
      tagName: string;
      text: string;
      element: any;
      path: string;
    }> = [];

    const getElementPath = (element: any): string => {
      const pathParts: string[] = [];
      let current = element;

      while (current && current.type === 'tag') {
        const tagName = current.name;
        const siblings = $(current).siblings(tagName).toArray();
        const index = siblings.findIndex((sibling) => sibling === current);

        if (index > -1) {
          pathParts.unshift(`${tagName}:nth-child(${index + 1})`);
        } else {
          pathParts.unshift(tagName);
        }

        current = current.parent;
        if (!current || current.name === 'html') break;
      }

      return pathParts.join(' > ');
    };

    $('*').each((_, element) => {
      const $el = $(element);
      const immediateText = $el.contents().filter(function () {
        return this.type === 'text' && $(this).text().trim() !== '';
      });

      if (immediateText.length > 0) {
        immediateText.each((_, textNode) => {
          const text = $(textNode).text().trim();
          if (text) {
            results.push({
              tagName: $el.prop('tagName')?.toLowerCase() || 'unknown',
              text: text,
              element: element,
              path: getElementPath(element),
            });
          }
        });
      }
    });

    return results;
  }

  /**
   * Run the Python script for entity extraction
   * @param texts Array of text samples to process
   * @returns Promise resolving to the result of the Python script
   */
  private async runPythonScript(texts: string[]): Promise<any> {
    return new Promise((resolve, reject) => {
      const processedSample = texts.map(
        (text) => '"' + text.replace(/"/g, '\\"') + '"',
      );
      const pythonProcess = spawn('python', [
        this.extractorPath,
        ...processedSample,
      ]);
      let dataString = [];
      let errorString = '';
      pythonProcess.stdout.on('data', (data) => {
        dataString = dataString.concat(JSON.parse(data.toString()));
      });

      pythonProcess.stderr.on('data', (data) => {
        errorString += data.toString();
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
          resolve(dataString);
        } catch (parseError) {
          this.logger.error(
            `Failed to parse extraction result: ${parseError.message}`,
          );
          reject(
            new Error(
              `Failed to parse extraction result: ${parseError.message}`,
            ),
          );
        }
      });

      pythonProcess.on('error', (error) => {
        this.logger.error(`Failed to start Python process: ${error.message}`);
        reject(new Error(`Failed to start Python process: ${error.message}`));
      });
    });

    return texts;
  }
}

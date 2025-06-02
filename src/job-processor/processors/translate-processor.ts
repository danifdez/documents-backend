import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { Job } from 'src/job/job.interface';
import { ResourceService } from 'src/resource/resource.service';
import * as cheerio from 'cheerio';
import { JobService } from 'src/job/job.service';
import { JobProcessorClientService } from '../job-processor-client.service';

@Injectable()
export class TranslateProcessor implements JobProcessor {
  private readonly logger = new Logger(TranslateProcessor.name);
  private readonly JOB_TYPE = 'translate';

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
    const sourceLanguage = job.payload['sourceLanguage'] as string;
    const targetLanguage = job.payload['targetLanguage'] as string;
    const saveTo = job.payload['saveTo'] as string;

    const resource = await this.resourceService.findOne(resourceId);

    if (!resource || !resource?.content) {
      throw new Error(`Resource with ID ${resourceId} not found`);
    }

    this.logger.log(`Processing HTML content for resource ${resourceId}`);

    const extractedTexts = this.extractTextFromHtml(resource.content);
    this.logger.log(
      `Extracted ${extractedTexts.length} text elements from HTML`,
    );

    const translations: Array<{
      path: string;
      originalText: string;
      translatedText: string;
    }> = [];

    for (let i = 0; i < extractedTexts.length; i += 32) {
      const chunk = extractedTexts.slice(i, i + 32);
      const textsToTranslate = chunk.map(item => item.text);

      try {
        const translatedTexts = await this.translate(
          sourceLanguage,
          targetLanguage,
          textsToTranslate,
        );
        const translatedTextArray = translatedTexts.translated_texts || [];

        chunk.forEach((item, index) => {
          if (translatedTextArray[index]) {
            translations.push({
              path: item.path,
              originalText: item.text,
              translatedText: translatedTextArray[index],
            });
          }
        });
      } catch (error) {
        this.logger.error(`Translation error for chunk ${i / 4}: ${error.message}`);
      }
    }

    if (translations.length > 0) {
      const translatedHtml = this.updateHtmlWithTranslations(
        resource.content,
        translations,
      );

      const $ = cheerio.load(translatedHtml);
      const bodyContent = $('body').html() || translatedHtml;

      await this.resourceService.update(resourceId, {
        [saveTo]: bodyContent,
      });

      if (targetLanguage === 'en') {
        this.jobService.create('entity-extraction', {
          resourceId: resourceId,
          from: saveTo,
        });
        this.jobService.create('ingest-content', {
          resourceId: resourceId,
          projectId: resource.project,
          content: bodyContent,
        });
      }

      return {
        success: true,
        message: `Translated ${translations.length} text elements in HTML`,
      };
    }

    return {
      success: true,
      message: 'Translation processed',
    };
  }

  /**
   * Run the Python script to detect language
   * @param sourceLanguage Source language code
   * @param targetLanguage Target language code
   * @param sample Text sample to process
   * @returns Promise resolving to the translated text array
   */
  private translate(
    sourceLanguage: string,
    targetLanguage: string,
    sample: string[],
  ): Promise<any> {
    return this.jobProcessorClientService.post('translate', {
      source: sourceLanguage,
      target: targetLanguage,
      texts: sample,
    });
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
   * Updates HTML content with translated text
   * @param html Original HTML content
   * @param translations Array of objects with path and translated text
   * @returns Updated HTML content with translations applied
   */
  private updateHtmlWithTranslations(
    html: string,
    translations: Array<{
      path: string;
      originalText: string;
      translatedText: string;
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
              $(node).text().trim() === item.originalText
            ) {
              $(node).replaceWith(item.translatedText);
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

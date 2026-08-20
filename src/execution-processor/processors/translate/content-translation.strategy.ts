import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { ResourceService } from 'src/resource/resource.service';
import { ExecutionEntity } from 'src/execution/execution.entity';
import {
  TranslationStrategy,
  TRANSLATE_LOG_CONTEXT,
} from './translation-strategy.interface';

@Injectable()
export class ContentTranslationStrategy implements TranslationStrategy {
  private readonly logger = new Logger(TRANSLATE_LOG_CONTEXT);

  constructor(private readonly resourceService: ResourceService) {}

  async execute(execution: ExecutionEntity): Promise<any> {
    const resourceId = Number(execution.payload['resourceId']) as number;
    const saveTo = execution.payload['saveTo'] || 'translatedContent';
    const results = execution.result as {
      response: Array<{
        path: string;
        original_text: string;
        translation_text: string;
      }>;
    };

    // Validate execution.result
    if (!results || !Array.isArray(results.response)) {
      const errorMessage = `Invalid translation result for content translation. Expected execution.result.response to be an array but got: ${JSON.stringify(execution.result)}`;
      this.logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    const resource = await this.resourceService.getContentById(resourceId);

    if (!resource) {
      const errorMessage = `Resource with id ${resourceId} not found`;
      this.logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    let sourceContent = resource;

    if (!sourceContent) {
      const errorMessage = `Resource ${resourceId} has no content. Cannot translate.`;
      this.logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    if (typeof sourceContent !== 'string') {
      // If the content is an object (e.g., already parsed), attempt to stringify it safely
      try {
        this.logger.warn(
          `Resource content for ${resourceId} is not a string (type: ${typeof sourceContent}). Converting to string.`,
        );
        // If it's a buffer-like object with toString, use it
        if (
          sourceContent &&
          typeof (sourceContent as any).toString === 'function'
        ) {
          const converted = (sourceContent as any).toString();
          if (typeof converted === 'string' && converted.length > 0) {
            sourceContent = converted;
          } else {
            sourceContent = JSON.stringify(sourceContent);
          }
        } else {
          sourceContent = JSON.stringify(sourceContent);
        }
      } catch (err) {
        const errorMessage = `Failed to convert resource.content to string for resource ${resourceId}: ${err?.message || err}`;
        this.logger.error(errorMessage);
        throw new Error(errorMessage);
      }
    }

    const translatedHtml = this.updateHtmlWithTranslations(
      sourceContent,
      results.response,
    );

    // Guard cheerio.load() to ensure we pass a string
    if (typeof translatedHtml !== 'string') {
      const errorMessage = `Translated HTML is not a string for resource ${resourceId}. Type: ${typeof translatedHtml}`;
      this.logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    const $ = cheerio.load(translatedHtml);
    const bodyContent = $('body').html() || translatedHtml;

    await this.resourceService.update(resourceId, {
      [saveTo]: bodyContent,
    });

    return {
      success: true,
    };
  }

  /**
   * Updates HTML content with translated text while preserving the original structure
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
    // Load HTML with default options
    const $ = cheerio.load(html);

    translations.forEach((item) => {
      try {
        // Find the element using the path from translation
        const containerElement = $(item.path);

        if (containerElement.length > 0) {
          // Iterate through all text nodes in the container
          containerElement.contents().each((_, node) => {
            if (node.type === 'text') {
              const nodeText = $(node).text();
              // Match the original text more flexibly (trim whitespace for comparison)
              if (nodeText.trim() === item.original_text.trim()) {
                // Replace with translated text, preserving any surrounding whitespace
                const leadingSpace = nodeText.match(/^\s*/)?.[0] || '';
                const trailingSpace = nodeText.match(/\s*$/)?.[0] || '';
                $(node).replaceWith(
                  `${leadingSpace}${item.translation_text}${trailingSpace}`,
                );
              }
            }
          });
        } else {
          this.logger.warn(
            `Element not found for path "${item.path}" while translating "${item.original_text.substring(0, 50)}..."`,
          );
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

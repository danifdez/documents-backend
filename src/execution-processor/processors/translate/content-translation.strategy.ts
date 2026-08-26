import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { ExecutionEntity } from '../../../execution/execution.entity';
import { ExecutionEffectJournalService } from '../../../execution/execution-effect-journal.service';
import { ResourceEntity } from '../../../resource/resource.entity';
import { canonicalHash } from '../../../execution/execution-canonical';
import {
  TranslationStrategy,
  TRANSLATE_LOG_CONTEXT,
} from './translation-strategy.interface';

@Injectable()
export class ContentTranslationStrategy implements TranslationStrategy {
  private readonly logger = new Logger(TRANSLATE_LOG_CONTEXT);

  constructor(private readonly effectJournal: ExecutionEffectJournalService) {}

  async execute(execution: ExecutionEntity): Promise<any> {
    const resourceId = Number(execution.payload['resourceId']) as number;
    const results = execution.result as {
      response: Array<{
        path: string;
        original_text: string;
        translation_text: string;
      }>;
    };

    // Validate execution.result
    if (!results || !Array.isArray(results.response)) {
      const errorMessage =
        'Invalid translation result for content translation. Expected ' +
        'execution.result.response to be an array but got: ' +
        JSON.stringify(execution.result);
      this.logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    if (!Number.isInteger(resourceId) || resourceId <= 0) {
      throw new Error('Content translation requires a valid resourceId');
    }

    await this.effectJournal.runVerified(
      {
        executionId: execution.executionId,
        effectKey: `content-translation-resource-replace:${resourceId}`,
        effectType: 'resource_translated_content_replace',
        resourceKey: `resource:${resourceId}`,
        intent: { resourceId, translations: results.response },
      },
      async (manager) => {
        const repository = manager.getRepository(ResourceEntity);
        const resource = await repository.findOne({
          where: { id: resourceId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!resource) {
          throw new Error(`Resource with id ${resourceId} not found`);
        }
        if (!resource.content) {
          throw new Error(
            `Resource ${resourceId} has no content. Cannot translate.`,
          );
        }

        const translatedHtml = this.updateHtmlWithTranslations(
          resource.content,
          results.response,
        );
        const $ = cheerio.load(translatedHtml);
        const translatedContent = $('body').html() || translatedHtml;
        const before = resource.translatedContent;
        resource.translatedContent = translatedContent;
        await repository.save(resource);
        const observed = await repository.findOneBy({ id: resourceId });
        if (observed?.translatedContent !== translatedContent) {
          throw new Error('resource_translation_effect_not_verified');
        }
        return {
          resourceId,
          sourceContentHash: canonicalHash(resource.content),
          beforeTranslationHash: canonicalHash(before),
          afterTranslationHash: canonicalHash(translatedContent),
        };
      },
    );

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
          const sourcePreview = item.original_text.substring(0, 50);
          this.logger.warn(
            `Element not found for path "${item.path}" while translating ` +
              `"${sourcePreview}..."`,
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

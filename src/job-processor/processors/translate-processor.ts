import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { JobPriority } from 'src/job/job-priority.enum';
import { ResourceService } from 'src/resource/resource.service';
import { EntityService } from 'src/entity/entity.service';
import { EntityTranslation } from 'src/entity/entity.entity';
import * as cheerio from 'cheerio';
import { JobService } from 'src/job/job.service';
import { JobEntity } from 'src/job/job.entity';

@Injectable()
export class TranslateProcessor implements JobProcessor {
  private readonly logger = new Logger(TranslateProcessor.name);
  private readonly JOB_TYPE = 'translate';

  constructor(
    private readonly resourceService: ResourceService,
    private readonly jobService: JobService,
    private readonly entityService: EntityService,
  ) { }

  canProcess(jobType: string): boolean {
    return jobType === this.JOB_TYPE;
  }

  async process(job: JobEntity): Promise<any> {
    const translationType = job.payload['translationType'];

    // Handle batch entity translations
    if (translationType === 'entities-batch') {
      return this.processEntitiesBatchTranslation(job);
    }

    // Handle single entity translation
    if (translationType === 'entity') {
      return this.processEntityTranslation(job);
    }

    // Handle content translation (existing logic)
    return this.processContentTranslation(job);
  }

  private async processEntitiesBatchTranslation(job: JobEntity): Promise<any> {
    const entityIdByIndex: number[] = job.payload['entityIdByIndex'] || [];
    const targetLanguage = job.payload['targetLanguage'] as string || job.payload['targetLanguage'] || 'es';

    this.logger.log(`Processing entities-batch translation for ${entityIdByIndex.length} entities`);
    this.logger.debug(`Job result: ${JSON.stringify(job.result)}`);

    if (!job.result) {
      const errorMessage = `Job result is null or undefined`;
      this.logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    const results = job.result as { response: Array<{ translation_text: string; original_text?: string; path?: string }> };
    if (!results?.response || !Array.isArray(results.response)) {
      const errorMessage = `Invalid translation result format for entities-batch: ${JSON.stringify(results)}`;
      this.logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    // Map translated texts back to entities and update translations
    for (let i = 0; i < results.response.length; i++) {
      const item = results.response[i];
      const entityId = entityIdByIndex[i];
      if (!entityId) {
        this.logger.warn(`No entityId mapping for translation index ${i}`);
        continue;
      }

      const translatedText = item.translation_text || item.translation_text;
      if (!translatedText) {
        this.logger.warn(`No translated text for entity index ${i}`);
        continue;
      }

      try {
        // Merge translations directly without loading entity to avoid relation metadata issues
        const translationsToMerge: EntityTranslation = {
          [job.payload['targetLanguage'] || 'es']: translatedText,
        };

        await this.entityService.mergeTranslationsOnly(entityId, translationsToMerge);
        this.logger.log(`Updated entity ${entityId} with ${job.payload['targetLanguage'] || 'es'} translation`);
      } catch (err) {
        this.logger.error(`Failed to persist translation for entity ${entityId}: ${err.message}`);
      }
    }

    return { success: true, translated: results.response.length };
  }

  private async processEntityTranslation(job: JobEntity): Promise<any> {
    const entityId = Number(job.payload['entityId']) as number;
    const targetLanguage = job.payload['targetLanguage'] as string;
    const originalText = job.payload['originalText'] as string;

    this.logger.log(`Processing entity translation for entity ${entityId}, target language: ${targetLanguage}`);
    this.logger.debug(`Job result: ${JSON.stringify(job.result)}`);

    // Validate required parameters
    if (!entityId || isNaN(entityId)) {
      const errorMessage = `Invalid entity ID: ${entityId}`;
      this.logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    if (!targetLanguage) {
      const errorMessage = `Target language is required`;
      this.logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    if (!originalText) {
      const errorMessage = `Original text is required`;
      this.logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    // Check if job.result is null or undefined
    if (!job.result) {
      const errorMessage = `Job result is null or undefined`;
      this.logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    // Get the translation result from the job
    const results = job.result as {
      response: Array<{
        path?: string;
        original_text: string;
        translation_text: string;
      }>;
    };

    if (!results?.response || !Array.isArray(results.response) || results.response.length === 0) {
      const errorMessage = `Invalid translation result format. Expected response array but got: ${JSON.stringify(results)}`;
      this.logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    // Find the entity
    const entity = await this.entityService.findOne(entityId);
    if (!entity) {
      const errorMessage = `Entity with id ${entityId} not found`;
      this.logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    try {
      // Get the translated text from the first response item
      const translatedText = results.response[0].translation_text;

      if (!translatedText) {
        throw new Error(`No translation text found in result: ${JSON.stringify(results.response[0])}`);
      }

      // Merge the translation into the JSONB column using SQL to avoid touching relations
      const translationsToMerge: EntityTranslation = {
        [targetLanguage]: translatedText,
      };
      await this.entityService.mergeTranslations(entityId, translationsToMerge);

      this.logger.log(
        `Successfully updated entity ${entityId} (${entity.name}) with ${targetLanguage} translation: "${translatedText}"`
      );

      return {
        success: true,
        entityId,
        entityName: entity.name,
        targetLanguage,
        translatedText
      };
    } catch (error) {
      this.logger.error(`Failed to update entity ${entityId} with translation:`, error.message);
      throw error;
    }
  }

  private async processContentTranslation(job: JobEntity): Promise<any> {
    const resourceId = Number(job.payload['resourceId']) as number;
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

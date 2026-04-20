import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { JobPriority } from 'src/job/job-priority.enum';
import { ResourceService } from 'src/resource/resource.service';
import { EntityService } from 'src/entity/entity.service';
import { EntityTranslation } from 'src/entity/entity.entity';
import * as cheerio from 'cheerio';
import { JobService } from 'src/job/job.service';
import { JobEntity } from 'src/job/job.entity';
import { PendingEntityService } from 'src/pending-entity/pending-entity.service';
import { extractTextFromHtml } from 'src/utils/text';

@Injectable()
export class TranslateProcessor implements JobProcessor {
  private readonly logger = new Logger(TranslateProcessor.name);
  private readonly JOB_TYPE = 'translate';

  constructor(
    private readonly resourceService: ResourceService,
    private readonly jobService: JobService,
    private readonly entityService: EntityService,
    private readonly pendingEntityService: PendingEntityService,
  ) { }

  canProcess(jobType: string): boolean {
    return jobType === this.JOB_TYPE;
  }

  async process(job: JobEntity): Promise<any> {
    const translationType = job.payload['translationType'];

    // Handle batch entity translations for pending entities (before creation)
    if (translationType === 'entities-pending-batch') {
      return this.processEntitiesPendingBatchTranslation(job);
    }

    // Handle entity retranslation (when name changes)
    if (translationType === 'entity-retranslate') {
      return this.processEntityRetranslation(job);
    }

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

  /**
   * Process translation of entities BEFORE creating them as pending entities.
   * This ensures entities are translated before being shown to users.
   * Handles multiple target languages by translating to all and then creating pending entities.
   */
  private async processEntitiesPendingBatchTranslation(job: JobEntity): Promise<any> {
    const entityDataByIndex: Array<{ word: string; entityType: string }> = job.payload['entityDataByIndex'] || [];
    const resourceId = Number(job.payload['resourceId']);
    const targetLanguages = (job.payload['targetLanguages'] as string[]) || [job.payload['targetLanguage'] as string] || ['es'];
    const sourceLanguage = job.payload['sourceLanguage'] as string || 'en';

    this.logger.log(`Processing entities-pending-batch translation for ${entityDataByIndex.length} entities to languages: ${targetLanguages.join(', ')}`);

    if (!job.result) {
      const errorMessage = `Job result is null or undefined`;
      this.logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    const results = job.result as { response: Array<{ translation_text: string; original_text?: string }> };
    if (!results?.response || !Array.isArray(results.response)) {
      const errorMessage = `Invalid translation result format for entities-pending-batch: ${JSON.stringify(results)}`;
      this.logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    const currentTargetLanguage = targetLanguages[0];
    const remainingLanguages = targetLanguages.slice(1);
    const isTranslatingToEnglish = currentTargetLanguage === 'en';

    const entityTypeMapping = {
      'GPE': 'GEOPOLITICAL',
      'LOC': 'LOCATION',
      'NORP': 'NATIONALITY',
      'PERSON': 'PERSON',
      'ORG': 'ORGANIZATION',
      'EVENT': 'EVENT',
      'FAC': 'FACILITY',
      'PRODUCT': 'PRODUCT',
      'WORK_OF_ART': 'WORK_OF_ART',
      'LANGUAGE': 'LANGUAGE',
      'LAW': 'LAW',
    };

    const concurrency = 5;
    const createOrUpdatePendingEntity = async (index: number) => {
      if (index >= entityDataByIndex.length) return null;

      const entityData = entityDataByIndex[index];
      const translationResult = results.response[index];

      if (!entityData || !translationResult) {
        this.logger.warn(`Missing data for entity at index ${index}`);
        return null;
      }

      const mappedEntityType = entityTypeMapping[entityData.entityType] || null;
      const entityType = mappedEntityType
        ? await this.entityService['entityTypeService'].findByName(mappedEntityType)
        : null;

      // Check if pending entity already exists for this resource
      const existingPendingEntities = await this.pendingEntityService.findByResourceId(resourceId);

      if (isTranslatingToEnglish) {
        // When translating to English: name = English translation, translations = { sourceLanguage: original }
        const englishName = translationResult.translation_text;
        const existingEntity = existingPendingEntities.find(e => e.name === entityData.word || e.name === englishName);

        if (existingEntity) {
          const updatedTranslations = {
            ...(existingEntity.translations || {}),
            [sourceLanguage]: entityData.word,
          };
          await this.pendingEntityService.update(existingEntity.id, {
            name: englishName,
            translations: updatedTranslations,
          });
          this.logger.log(`Updated pending entity to English name "${englishName}" (was "${entityData.word}")`);
          return existingEntity;
        } else {
          try {
            const pendingEntity = await this.pendingEntityService.create({
              resourceId,
              name: englishName,
              entityTypeId: entityType?.id,
              translations: { [sourceLanguage]: entityData.word },
            });
            this.logger.log(`Created pending entity "${englishName}" with ${sourceLanguage} translation "${entityData.word}"`);
            return pendingEntity;
          } catch (err) {
            this.logger.error(`Failed to create pending entity for "${englishName}": ${err.message}`);
            return null;
          }
        }
      } else {
        // When translating to other languages: name stays as-is, add translation
        const existingEntity = existingPendingEntities.find(e => e.name === entityData.word);

        if (existingEntity) {
          const updatedTranslations = {
            ...(existingEntity.translations || {}),
            [currentTargetLanguage]: translationResult.translation_text,
          };
          await this.pendingEntityService.update(existingEntity.id, {
            translations: updatedTranslations,
          });
          this.logger.log(`Updated pending entity "${entityData.word}" with ${currentTargetLanguage} translation`);
          return existingEntity;
        } else {
          try {
            const pendingEntity = await this.pendingEntityService.create({
              resourceId,
              name: entityData.word,
              entityTypeId: entityType?.id,
              translations: { [currentTargetLanguage]: translationResult.translation_text },
            });
            this.logger.log(`Created pending entity "${entityData.word}" with ${currentTargetLanguage} translation`);
            return pendingEntity;
          } catch (err) {
            this.logger.error(`Failed to create pending entity for "${entityData.word}": ${err.message}`);
            return null;
          }
        }
      }
    };

    const indices = Array.from({ length: entityDataByIndex.length }, (_, i) => i);
    const pendingEntities = [];

    for (let i = 0; i < indices.length; i += concurrency) {
      const batch = indices.slice(i, i + concurrency);
      const batchResults = await Promise.all(batch.map(createOrUpdatePendingEntity));
      pendingEntities.push(...batchResults.filter(Boolean));
    }

    // If there are more languages to translate, create a follow-up job
    if (remainingLanguages.length > 0) {
      const textsForTranslation = entityDataByIndex.map(entity => ({ text: entity.word }));

      await this.jobService.create('translate', JobPriority.HIGH, {
        translationType: 'entities-pending-batch',
        sourceLanguage,
        targetLanguages: remainingLanguages,
        texts: textsForTranslation,
        entityDataByIndex,
        resourceId,
      });

      this.logger.log(`Created follow-up translation job for remaining languages: ${remainingLanguages.join(', ')}`);
    }

    // Update resource status to 'entities' so the UI shows the entities tab
    await this.resourceService.update(resourceId, { status: 'entities' });

    return {
      success: true,
      translated: results.response.length,
      pendingEntitiesCreated: pendingEntities.length,
      remainingLanguages: remainingLanguages.length,
    };
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

  private async processEntityRetranslation(job: JobEntity): Promise<any> {
    const entityId = Number(job.payload['entityId']) as number;
    const targetLanguages = job.payload['targetLanguages'] as string[];

    this.logger.log(`Processing entity retranslation for pending entity ${entityId}, target languages: ${targetLanguages.join(', ')}`);
    this.logger.debug(`Job result: ${JSON.stringify(job.result)}`);

    // Validate required parameters
    if (!entityId || isNaN(entityId)) {
      const errorMessage = `Invalid entity ID: ${entityId}`;
      this.logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    if (!targetLanguages || !Array.isArray(targetLanguages) || targetLanguages.length === 0) {
      const errorMessage = `Target languages array is required and must not be empty`;
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

    // Find the pending entity
    const pendingEntity = await this.pendingEntityService.findOne(entityId);
    if (!pendingEntity) {
      const errorMessage = `Pending entity with id ${entityId} not found`;
      this.logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    try {
      // Build translations object from results
      const translationsToMerge: Record<string, string> = {};

      for (let i = 0; i < results.response.length; i++) {
        const item = results.response[i];
        const translatedText = item.translation_text;

        if (!translatedText) {
          this.logger.warn(`No translated text for index ${i}`);
          continue;
        }

        // Match translation to target language by index
        if (i < targetLanguages.length) {
          const targetLang = targetLanguages[i];
          translationsToMerge[targetLang] = translatedText;
          this.logger.log(`Mapped translation for ${targetLang}: "${translatedText}"`);
        }
      }

      // Update pending entity translations
      await this.pendingEntityService.updateTranslations(entityId, translationsToMerge);

      this.logger.log(
        `Successfully updated pending entity ${entityId} (${pendingEntity.name}) with translations for: ${Object.keys(translationsToMerge).join(', ')}`
      );

      return {
        success: true,
        entityId,
        entityText: pendingEntity.name,
        updatedLanguages: Object.keys(translationsToMerge),
        translations: translationsToMerge
      };
    } catch (error) {
      this.logger.error(`Failed to update pending entity ${entityId} with translations:`, error.message);
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

    // Validate job.result
    if (!results || !Array.isArray(results.response)) {
      const errorMessage = `Invalid translation result for content translation. Expected job.result.response to be an array but got: ${JSON.stringify(job.result)}`;
      this.logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    const resource = await this.resourceService.getContentById(resourceId);

    if (!resource) {
      const errorMessage = `Resource with id ${resourceId} not found`;
      this.logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    // Determine source content: try content, workingContent, then translatedContent
    let sourceContent = resource;
    let contentSource = 'content';

    if (!sourceContent) {
      const errorMessage = `Resource ${resourceId} has no content in any field (content, workingContent, translatedContent). Cannot translate.`;
      this.logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    this.logger.log(`Using ${contentSource} as source for translation of resource ${resourceId}`);

    if (typeof sourceContent !== 'string') {
      // If the content is an object (e.g., already parsed), attempt to stringify it safely
      try {
        this.logger.warn(`Resource content for ${resourceId} is not a string (type: ${typeof sourceContent}). Converting to string.`);
        // If it's a buffer-like object with toString, use it
        if (sourceContent && typeof (sourceContent as any).toString === 'function') {
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
    const resourceEntity = await this.resourceService.findOne(resourceId);

    if (resourceEntity.status === 'translating') {
      // Update status to 'entities' and launch entity extraction job
      await this.resourceService.update(resourceId, { status: 'entities' });
      const resourceContent = await this.resourceService.getContentById(resourceId);

      const extractedTexts = extractTextFromHtml(resourceContent || '');

      await this.jobService.create('entity-extraction', JobPriority.NORMAL, {
        resourceId: resourceId,
        texts: extractedTexts,
      });

      const anchorDate = resourceEntity.publicationDate
        ? String(resourceEntity.publicationDate).slice(0, 10)
        : null;
      await this.jobService.create('date-extraction', JobPriority.NORMAL, {
        resourceId,
        text: resourceContent || '',
        language: resourceEntity.language || 'en',
        anchorDate,
      });
    }

    // Ingest translated content into vector database
    if (job.payload['triggerIngest']) {
      const projectId = (resourceEntity?.project as any)?.id || null;
      await this.jobService.create('ingest-content', JobPriority.NORMAL, {
        resourceId,
        projectId,
        content: bodyContent,
      });
    }

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
                $(node).replaceWith(`${leadingSpace}${item.translation_text}${trailingSpace}`);
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

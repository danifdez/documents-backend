import { Injectable, Logger } from '@nestjs/common';
import { JobEntity } from 'src/job/job.entity';
import { PendingEntityService } from 'src/pending-entity/pending-entity.service';
import {
  TranslationStrategy,
  TRANSLATE_LOG_CONTEXT,
} from './translation-strategy.interface';

@Injectable()
export class EntityRetranslationStrategy implements TranslationStrategy {
  private readonly logger = new Logger(TRANSLATE_LOG_CONTEXT);

  constructor(private readonly pendingEntityService: PendingEntityService) { }

  async execute(job: JobEntity): Promise<any> {
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
}

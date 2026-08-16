import { Injectable, Logger } from '@nestjs/common';
import { EntityService } from 'src/entity/entity.service';
import { EntityTranslation } from 'src/entity/entity.entity';
import { JobEntity } from 'src/job/job.entity';
import {
  TranslationStrategy,
  TRANSLATE_LOG_CONTEXT,
} from './translation-strategy.interface';

@Injectable()
export class EntitiesBatchTranslationStrategy implements TranslationStrategy {
  private readonly logger = new Logger(TRANSLATE_LOG_CONTEXT);

  constructor(private readonly entityService: EntityService) { }

  async execute(job: JobEntity): Promise<any> {
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
}

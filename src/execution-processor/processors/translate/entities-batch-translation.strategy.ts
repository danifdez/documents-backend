import { Injectable } from '@nestjs/common';
import { EntityService } from 'src/entity/entity.service';
import { EntityTranslation } from 'src/entity/entity.entity';
import { ExecutionEntity } from 'src/execution/execution.entity';
import { TranslationStrategyBase } from './translation-strategy.base';

@Injectable()
export class EntitiesBatchTranslationStrategy extends TranslationStrategyBase {
  constructor(private readonly entityService: EntityService) {
    super();
  }

  async execute(execution: ExecutionEntity): Promise<any> {
    const entityIdByIndex: number[] =
      execution.payload['entityIdByIndex'] || [];
    const targetLanguage =
      (execution.payload['targetLanguage'] as string) ||
      execution.payload['targetLanguage'] ||
      'es';

    this.logger.log(
      `Processing entities-batch translation for ${entityIdByIndex.length} entities`,
    );
    this.logger.debug(`Execution result: ${JSON.stringify(execution.result)}`);

    const results = this.getBatchResults(execution, 'entities-batch');

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
          [execution.payload['targetLanguage'] || 'es']: translatedText,
        };

        await this.entityService.mergeTranslationsOnly(
          entityId,
          translationsToMerge,
        );
        this.logger.log(
          `Updated entity ${entityId} with ${execution.payload['targetLanguage'] || 'es'} translation`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to persist translation for entity ${entityId}: ${err.message}`,
        );
      }
    }

    return { success: true, translated: results.response.length };
  }
}

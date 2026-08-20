import { Injectable } from '@nestjs/common';
import { EntityService } from 'src/entity/entity.service';
import { EntityEntity, EntityTranslation } from 'src/entity/entity.entity';
import { ExecutionEntity } from 'src/execution/execution.entity';
import {
  SingleEntityTranslationStrategyBase,
  TranslationResults,
} from './translation-strategy.base';

@Injectable()
export class EntityTranslationStrategy extends SingleEntityTranslationStrategyBase<EntityEntity> {
  constructor(private readonly entityService: EntityService) {
    super();
  }

  protected logStart(execution: ExecutionEntity, entityId: number): void {
    const targetLanguage = execution.payload['targetLanguage'] as string;
    this.logger.log(
      `Processing entity translation for entity ${entityId}, target language: ${targetLanguage}`,
    );
  }

  protected validatePayload(execution: ExecutionEntity): void {
    const targetLanguage = execution.payload['targetLanguage'] as string;
    const originalText = execution.payload['originalText'] as string;

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
  }

  protected findEntity(entityId: number): Promise<EntityEntity | null> {
    return this.entityService.findOne(entityId);
  }

  protected entityNotFoundMessage(entityId: number): string {
    return `Entity with id ${entityId} not found`;
  }

  protected updateFailureMessage(entityId: number): string {
    return `Failed to update entity ${entityId} with translation:`;
  }

  protected async applyTranslations(
    execution: ExecutionEntity,
    entityId: number,
    entity: EntityEntity,
    results: TranslationResults,
  ): Promise<any> {
    const targetLanguage = execution.payload['targetLanguage'] as string;

    const translatedText = results.response[0].translation_text;

    if (!translatedText) {
      throw new Error(
        `No translation text found in result: ${JSON.stringify(results.response[0])}`,
      );
    }

    // Merge the translation into the JSONB column using SQL to avoid touching relations
    const translationsToMerge: EntityTranslation = {
      [targetLanguage]: translatedText,
    };
    await this.entityService.mergeTranslations(entityId, translationsToMerge);

    this.logger.log(
      `Successfully updated entity ${entityId} (${entity.name}) with ${targetLanguage} translation: "${translatedText}"`,
    );

    return {
      success: true,
      entityId,
      entityName: entity.name,
      targetLanguage,
      translatedText,
    };
  }
}

import { Injectable } from '@nestjs/common';
import { JobEntity } from 'src/job/job.entity';
import { PendingEntityService } from 'src/pending-entity/pending-entity.service';
import { PendingEntityEntity } from 'src/pending-entity/pending-entity.entity';
import {
  SingleEntityTranslationStrategyBase,
  TranslationResults,
} from './translation-strategy.base';

@Injectable()
export class EntityRetranslationStrategy extends SingleEntityTranslationStrategyBase<PendingEntityEntity> {
  constructor(private readonly pendingEntityService: PendingEntityService) {
    super();
  }

  protected logStart(job: JobEntity, entityId: number): void {
    const targetLanguages = job.payload['targetLanguages'] as string[];
    this.logger.log(`Processing entity retranslation for pending entity ${entityId}, target languages: ${targetLanguages.join(', ')}`);
  }

  protected validatePayload(job: JobEntity): void {
    const targetLanguages = job.payload['targetLanguages'] as string[];

    if (!targetLanguages || !Array.isArray(targetLanguages) || targetLanguages.length === 0) {
      const errorMessage = `Target languages array is required and must not be empty`;
      this.logger.error(errorMessage);
      throw new Error(errorMessage);
    }
  }

  protected findEntity(entityId: number): Promise<PendingEntityEntity | null> {
    return this.pendingEntityService.findOne(entityId);
  }

  protected entityNotFoundMessage(entityId: number): string {
    return `Pending entity with id ${entityId} not found`;
  }

  protected updateFailureMessage(entityId: number): string {
    return `Failed to update pending entity ${entityId} with translations:`;
  }

  protected async applyTranslations(
    job: JobEntity,
    entityId: number,
    pendingEntity: PendingEntityEntity,
    results: TranslationResults,
  ): Promise<any> {
    const targetLanguages = job.payload['targetLanguages'] as string[];

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
  }
}

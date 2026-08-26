import { Injectable } from '@nestjs/common';
import { ExecutionEntity } from '../../../execution/execution.entity';
import { PendingEntityService } from '../../../pending-entity/pending-entity.service';
import { PendingEntityEntity } from '../../../pending-entity/pending-entity.entity';
import { ExecutionEffectJournalService } from '../../../execution/execution-effect-journal.service';
import { canonicalHash } from '../../../execution/execution-canonical';
import {
  SingleEntityTranslationStrategyBase,
  TranslationResults,
} from './translation-strategy.base';

@Injectable()
export class EntityRetranslationStrategy extends SingleEntityTranslationStrategyBase<PendingEntityEntity> {
  constructor(
    private readonly pendingEntityService: PendingEntityService,
    private readonly effectJournal: ExecutionEffectJournalService,
  ) {
    super();
  }

  protected logStart(execution: ExecutionEntity, entityId: number): void {
    const targetLanguages = execution.payload['targetLanguages'] as string[];
    this.logger.log(
      `Processing entity retranslation for pending entity ${entityId}, target languages: ${targetLanguages.join(', ')}`,
    );
  }

  protected validatePayload(execution: ExecutionEntity): void {
    const targetLanguages = execution.payload['targetLanguages'] as string[];

    if (
      !targetLanguages ||
      !Array.isArray(targetLanguages) ||
      targetLanguages.length === 0
    ) {
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
    execution: ExecutionEntity,
    entityId: number,
    pendingEntity: PendingEntityEntity,
    results: TranslationResults,
  ): Promise<any> {
    const targetLanguages = execution.payload['targetLanguages'] as string[];

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
        this.logger.log(
          `Mapped translation for ${targetLang}: "${translatedText}"`,
        );
      }
    }

    await this.effectJournal.runVerified(
      {
        executionId: execution.executionId,
        effectKey: `entity-retranslation:${entityId}`,
        effectType: 'pending_entity_translations_merge',
        resourceKey: `pending-entity:${entityId}`,
        intent: { entityId, translations: translationsToMerge },
      },
      async (manager) => {
        const repository = manager.getRepository(PendingEntityEntity);
        const current = await repository.findOne({
          where: { id: entityId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!current) {
          throw new Error(`Pending entity with id ${entityId} not found`);
        }
        const before = current.translations ?? {};
        current.translations = { ...before, ...translationsToMerge };
        await repository.save(current);
        const observed = await repository.findOneBy({ id: entityId });
        if (
          canonicalHash(observed?.translations ?? {}) !==
          canonicalHash(current.translations)
        ) {
          throw new Error('pending_entity_translation_effect_not_verified');
        }
        return {
          entityId,
          beforeHash: canonicalHash(before),
          afterHash: canonicalHash(current.translations),
          updatedLanguages: Object.keys(translationsToMerge).sort(),
        };
      },
    );

    this.logger.log(
      `Successfully updated pending entity ${entityId} (${pendingEntity.name}) with translations for: ${Object.keys(translationsToMerge).join(', ')}`,
    );

    return {
      success: true,
      entityId,
      entityText: pendingEntity.name,
      updatedLanguages: Object.keys(translationsToMerge),
      translations: translationsToMerge,
    };
  }
}

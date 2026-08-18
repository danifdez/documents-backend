import { Injectable } from '@nestjs/common';
import { JobPriority } from 'src/job/job-priority.enum';
import { ResourceService } from 'src/resource/resource.service';
import { EntityTypeService } from 'src/entity-type/entity-type.service';
import { JobService } from 'src/job/job.service';
import { JobEntity } from 'src/job/job.entity';
import { PendingEntityService } from 'src/pending-entity/pending-entity.service';
import { PendingEntityEntity } from 'src/pending-entity/pending-entity.entity';
import { TranslationStrategyBase } from './translation-strategy.base';

// NER labels as the worker emits them, mapped to the entity-type names stored here.
const ENTITY_TYPE_BY_NER_LABEL: Record<string, string> = {
  GPE: 'GEOPOLITICAL',
  LOC: 'LOCATION',
  NORP: 'NATIONALITY',
  PERSON: 'PERSON',
  ORG: 'ORGANIZATION',
  EVENT: 'EVENT',
  FAC: 'FACILITY',
  PRODUCT: 'PRODUCT',
  WORK_OF_ART: 'WORK_OF_ART',
  LANGUAGE: 'LANGUAGE',
  LAW: 'LAW',
};

interface EntityData {
  word: string;
  entityType: string;
}

interface TranslationItem {
  translation_text: string;
  original_text?: string;
}

interface PendingTranslationContext {
  resourceId: number;
  toEnglish: boolean;
  sourceLanguage: string;
  targetLanguage: string;
}

@Injectable()
export class EntitiesPendingBatchTranslationStrategy extends TranslationStrategyBase {
  constructor(
    private readonly resourceService: ResourceService,
    private readonly jobService: JobService,
    private readonly entityTypeService: EntityTypeService,
    private readonly pendingEntityService: PendingEntityService,
  ) {
    super();
  }

  /**
   * Process translation of entities BEFORE creating them as pending entities.
   * This ensures entities are translated before being shown to users.
   * Handles multiple target languages by translating to all and then creating pending entities.
   */
  async execute(job: JobEntity): Promise<any> {
    const entityDataByIndex: EntityData[] = job.payload['entityDataByIndex'] || [];
    const resourceId = Number(job.payload['resourceId']);
    const targetLanguages = (job.payload['targetLanguages'] as string[]) || [job.payload['targetLanguage'] as string] || ['es'];
    const sourceLanguage = job.payload['sourceLanguage'] as string || 'en';

    this.logger.log(`Processing entities-pending-batch translation for ${entityDataByIndex.length} entities to languages: ${targetLanguages.join(', ')}`);

    const results = this.getBatchResults(job, 'entities-pending-batch');

    const currentTargetLanguage = targetLanguages[0];
    const remainingLanguages = targetLanguages.slice(1);
    const isTranslatingToEnglish = currentTargetLanguage === 'en';

    const ctx: PendingTranslationContext = {
      resourceId,
      toEnglish: isTranslatingToEnglish,
      sourceLanguage,
      targetLanguage: currentTargetLanguage,
    };

    const concurrency = 5;
    const indices = Array.from(
      { length: entityDataByIndex.length },
      (_, i) => i,
    );
    const pendingEntities = [];

    for (let i = 0; i < indices.length; i += concurrency) {
      const batch = indices.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map((index) =>
          this.upsertPendingEntity(
            index,
            entityDataByIndex[index],
            results.response[index],
            ctx,
          ),
        ),
      );
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

  private async upsertPendingEntity(
    index: number,
    entityData: EntityData | undefined,
    translation: TranslationItem | undefined,
    ctx: PendingTranslationContext,
  ): Promise<PendingEntityEntity | null> {
    if (!entityData || !translation) {
      this.logger.warn(`Missing data for entity at index ${index}`);
      return null;
    }

    const mappedEntityType =
      ENTITY_TYPE_BY_NER_LABEL[entityData.entityType] || null;
    const entityType = mappedEntityType
      ? await this.entityTypeService.findByName(mappedEntityType)
      : null;

    // Re-read per entity: entities created earlier in this same run must be seen here.
    const existingPendingEntities =
      await this.pendingEntityService.findByResourceId(ctx.resourceId);

    // Translating to English promotes the translation to the canonical name and files
    // the original word under the source language; any other target keeps the name and
    // files the translation under the target language.
    const name = ctx.toEnglish ? translation.translation_text : entityData.word;
    const language = ctx.toEnglish ? ctx.sourceLanguage : ctx.targetLanguage;
    const translatedText = ctx.toEnglish
      ? entityData.word
      : translation.translation_text;

    const existing = existingPendingEntities.find(
      (e) => e.name === entityData.word || e.name === name,
    );

    if (existing) {
      await this.pendingEntityService.update(existing.id, {
        ...(ctx.toEnglish ? { name } : {}),
        translations: {
          ...(existing.translations || {}),
          [language]: translatedText,
        },
      });
      this.logger.log(
        ctx.toEnglish
          ? `Updated pending entity to English name "${name}" (was "${entityData.word}")`
          : `Updated pending entity "${entityData.word}" with ${ctx.targetLanguage} translation`,
      );
      return existing;
    }

    try {
      const pendingEntity = await this.pendingEntityService.create({
        resourceId: ctx.resourceId,
        name,
        entityTypeId: entityType?.id,
        translations: { [language]: translatedText },
      });
      this.logger.log(
        ctx.toEnglish
          ? `Created pending entity "${name}" with ${language} translation "${translatedText}"`
          : `Created pending entity "${name}" with ${language} translation`,
      );
      return pendingEntity;
    } catch (err) {
      this.logger.error(
        `Failed to create pending entity for "${name}": ${err.message}`,
      );
      return null;
    }
  }
}

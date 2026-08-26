import { Injectable, Logger } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { ExecutionEntity } from '../../execution/execution.entity';
import { ResourceEntity } from '../../resource/resource.entity';
import { ExecutionEffectJournalService } from '../../execution/execution-effect-journal.service';
import {
  canonicalHash,
  contentHash,
} from '../../execution/execution-canonical';

class EntityExtractionResourceNotFoundError extends Error {}
class EntityExtractionResourceChangedError extends Error {}

@Injectable()
export class EntityExtractionProcessor implements ExecutionProcessor {
  private readonly logger = new Logger(EntityExtractionProcessor.name);
  private readonly TASK_TYPE = 'entity-extraction';

  private readonly entityTypeMapping: Record<string, string> = {
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

  constructor(private readonly effectJournal: ExecutionEffectJournalService) {}

  canProcess(taskType: string): boolean {
    return taskType === this.TASK_TYPE;
  }

  async process(execution: ExecutionEntity): Promise<any> {
    const resourceId = Number(execution.payload['resourceId']) as number;
    const result = execution.result as { entities?: unknown } | null;
    const sourceContentHash = execution.payload['sourceContentHash'];
    const sourceLanguage = execution.payload['sourceLanguage'];
    if (!Number.isInteger(resourceId) || resourceId <= 0) {
      throw new Error('entity-extraction resourceId is invalid');
    }
    if (
      typeof sourceContentHash !== 'string' ||
      !/^sha256:[0-9a-f]{64}$/.test(sourceContentHash) ||
      typeof sourceLanguage !== 'string' ||
      !sourceLanguage.trim()
    ) {
      throw new Error('entity-extraction source identity is invalid');
    }
    if (!Array.isArray(result?.entities)) {
      throw new Error('entity-extraction result is invalid');
    }
    const entities = result.entities.map((value) => {
      if (!value || typeof value !== 'object') {
        throw new Error('entity-extraction entity is invalid');
      }
      const item = value as Record<string, unknown>;
      const word = typeof item.word === 'string' ? item.word.trim() : '';
      const entityType =
        typeof item.entity === 'string'
          ? this.entityTypeMapping[item.entity]
          : undefined;
      if (!word || !entityType) {
        throw new Error('entity-extraction entity is invalid');
      }
      return { word, entityType };
    });

    try {
      await this.effectJournal.runVerified(
        {
          executionId: execution.executionId,
          effectKey: `entity-extraction:${resourceId}`,
          effectType: 'pending_entities_replace',
          resourceKey: `resource:${resourceId}`,
          intent: {
            resourceId,
            sourceContentHash,
            sourceLanguage,
            entitiesHash: canonicalHash(entities),
          },
        },
        async (manager) => {
          const resources = manager.getRepository(ResourceEntity);
          const resource = await resources.findOne({
            where: { id: resourceId },
            lock: { mode: 'pessimistic_write' },
          });
          if (!resource) throw new EntityExtractionResourceNotFoundError();
          if (
            contentHash(resource.content ?? '') !== sourceContentHash ||
            (resource.language || 'en') !== sourceLanguage
          ) {
            throw new EntityExtractionResourceChangedError();
          }
          const typeNames = [
            ...new Set(entities.map((item) => item.entityType)),
          ];
          const typeRows = await manager.query(
            'SELECT id, name FROM entity_types WHERE name = ANY($1::text[])',
            [typeNames],
          );
          const typeIds = new Map(
            typeRows.map((row) => [String(row.name), Number(row.id)]),
          );
          if (typeIds.size !== typeNames.length) {
            throw new Error('entity_extraction_type_mapping_incomplete');
          }
          await manager.query(
            'DELETE FROM pending_entities WHERE resource_id = $1',
            [resourceId],
          );
          const pendingIds: number[] = [];
          for (const entity of entities) {
            const [inserted] = await manager.query(
              `INSERT INTO pending_entities
                 (resource_id, name, language, translations, entity_type_id,
                  scope, status)
               VALUES ($1, $2, $3, $4::jsonb, $5, 'document', 'pending')
               RETURNING id`,
              [
                resourceId,
                entity.word,
                sourceLanguage,
                JSON.stringify({ [sourceLanguage]: entity.word }),
                typeIds.get(entity.entityType),
              ],
            );
            const pendingId = Number(inserted?.id);
            if (!Number.isInteger(pendingId) || pendingId <= 0) {
              throw new Error('entity_extraction_pending_entity_not_persisted');
            }
            pendingIds.push(pendingId);
          }
          resource.status = 'entities';
          await resources.save(resource);
          const observedResource = await resources.findOneBy({
            id: resourceId,
          });
          const observedEntities = await manager.query(
            `SELECT pending.name, pending.language, pending.translations,
                    pending.scope, pending.status, type.name AS entity_type
             FROM pending_entities pending
             JOIN entity_types type ON type.id = pending.entity_type_id
             WHERE pending.resource_id = $1
             ORDER BY pending.id`,
            [resourceId],
          );
          const expectedEntities = entities.map((entity) => ({
            name: entity.word,
            language: sourceLanguage,
            translations: { [sourceLanguage]: entity.word },
            scope: 'document',
            status: 'pending',
            entity_type: entity.entityType,
          }));
          if (
            observedResource?.status !== 'entities' ||
            canonicalHash(observedEntities) !== canonicalHash(expectedEntities)
          ) {
            throw new Error('entity_extraction_effect_not_verified');
          }
          return {
            resourceId,
            sourceContentHash,
            sourceLanguage,
            entityCount: pendingIds.length,
            pendingIdsHash: canonicalHash(pendingIds),
            entitiesHash: canonicalHash(expectedEntities),
            resourceStatus: 'entities',
          };
        },
      );
    } catch (error) {
      if (error instanceof EntityExtractionResourceNotFoundError) {
        return { success: false, reason: 'not_found' };
      }
      if (error instanceof EntityExtractionResourceChangedError) {
        return { success: false, reason: 'stale' };
      }
      throw error;
    }

    this.logger.log(
      `Published ${entities.length} pending entities for resource ${resourceId}`,
    );

    return {
      success: true,
      entitiesProcessed: entities.length,
    };
  }
}

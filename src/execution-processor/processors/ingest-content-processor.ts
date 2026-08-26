import { Injectable, Logger } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { ExecutionEntity } from '../../execution/execution.entity';
import { ResourceEntity } from '../../resource/resource.entity';
import {
  VectorPointInput,
  VectorStoreService,
} from '../../vector/vector-store.service';
import {
  sourceIdForDoc,
  sourceIdForKnowledge,
  sourceIdForResource,
} from '../../vector/vector-source-id.util';
import { ExecutionArtifactService } from '../../execution/execution-artifact.service';
import { ExecutionEffectJournalService } from '../../execution/execution-effect-journal.service';
import {
  canonicalHash,
  contentHash,
} from '../../execution/execution-canonical';

class IngestContentResourceNotFoundError extends Error {}

@Injectable()
export class IngestContentProcessor implements ExecutionProcessor {
  private readonly logger = new Logger(IngestContentProcessor.name);
  private readonly TASK_TYPE = 'ingest-content';

  constructor(
    private readonly vectorStore: VectorStoreService,
    private readonly artifacts: ExecutionArtifactService,
    private readonly effectJournal: ExecutionEffectJournalService,
  ) {}

  canProcess(taskType: string): boolean {
    return taskType === this.TASK_TYPE;
  }

  async process(execution: ExecutionEntity): Promise<any> {
    const sourceType = execution.payload['sourceType'] || 'resource';
    const result = execution.result as Record<string, unknown> | null;
    const pointCount = Number(result?.pointCount);
    if (!Number.isInteger(pointCount) || pointCount < 0) {
      throw new Error('ingest-content result requires pointCount');
    }
    const documents = await this.artifacts.readOutputJson(
      execution,
      'vector_points',
      'vector_points',
    );
    const points = documents.flatMap((document) => {
      if (!Array.isArray(document.points)) {
        throw new Error('ingest-content vector_points artifact is invalid');
      }
      return document.points as VectorPointInput[];
    });
    if (points.length !== pointCount) {
      throw new Error('ingest-content artifact point count is invalid');
    }
    const projectId = this.projectId(execution.payload['projectId']);
    let sourceId: string;
    let payload: Record<string, unknown>;

    if (sourceType === 'resource') {
      const resourceId = Number(execution.payload['resourceId']);
      sourceId = sourceIdForResource(resourceId);
      payload = {
        type: 'ingest-content',
        message:
          `Document ingestion completed for resource with ID ${resourceId}. ` +
          'Resource is now ready.',
        resourceId,
      };
    } else if (sourceType === 'doc') {
      const docId = Number(execution.payload['docId']);
      sourceId = sourceIdForDoc(docId);
      payload = {
        type: 'ingest-content',
        message: `Document ingestion completed for doc ${docId}.`,
        docId,
      };
    } else if (sourceType === 'knowledge') {
      const knowledgeEntryId = Number(execution.payload['knowledgeEntryId']);
      sourceId = sourceIdForKnowledge(knowledgeEntryId);
      payload = {
        type: 'ingest-content',
        message: `Knowledge base entry ${knowledgeEntryId} ingested into RAG.`,
        knowledgeEntryId,
      };
    } else {
      throw new Error(`Unsupported ingest-content source type: ${sourceType}`);
    }
    try {
      await this.effectJournal.runVerified(
        {
          executionId: execution.executionId,
          effectKey: `ingest-content:${sourceId}`,
          effectType: 'workspace_vectors_replace',
          resourceKey: sourceId,
          intent: {
            sourceType,
            sourceId,
            projectId,
            pointCount,
            pointsHash: contentHash(JSON.stringify(points)),
          },
        },
        async (manager) => {
          let resource: ResourceEntity | null = null;
          if (sourceType === 'resource') {
            const repository = manager.getRepository(ResourceEntity);
            resource = await repository.findOne({
              where: { id: Number(execution.payload['resourceId']) },
              lock: { mode: 'pessimistic_write' },
            });
            if (!resource) throw new IngestContentResourceNotFoundError();
          }
          const vectors = await this.vectorStore.replaceWorkspaceSourceVerified(
            sourceType,
            sourceId,
            projectId,
            points,
            manager,
          );
          if (resource) {
            const repository = manager.getRepository(ResourceEntity);
            resource.status = 'ready';
            await repository.save(resource);
            const observed = await repository.findOneBy({ id: resource.id });
            if (observed?.status !== 'ready') {
              throw new Error('ingest_content_resource_effect_not_verified');
            }
          }
          return {
            sourceType,
            sourceId,
            projectId,
            pointCount: vectors.pointCount,
            pointIdsHash: canonicalHash(vectors.pointIds),
            resourceStatus: resource ? 'ready' : null,
          };
        },
      );
    } catch (error) {
      if (error instanceof IngestContentResourceNotFoundError) {
        return { success: false, reason: 'not_found' };
      }
      throw error;
    }
    return {
      success: true,
      publication: { socketEvent: 'notification', payload },
    };
  }

  private projectId(value: unknown): number | null {
    if (value == null) return null;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error('ingest-content projectId is invalid');
    }
    return parsed;
  }
}

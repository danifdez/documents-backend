import { Injectable, Logger } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { ExecutionEntity } from '../../execution/execution.entity';
import { ResourceService } from '../../resource/resource.service';
import {
  VectorPointInput,
  VectorStoreService,
} from '../../vector/vector-store.service';
import {
  sourceIdForDoc,
  sourceIdForKnowledge,
  sourceIdForResource,
} from '../../vector/vector-source-id.util';

@Injectable()
export class IngestContentProcessor implements ExecutionProcessor {
  private readonly logger = new Logger(IngestContentProcessor.name);
  private readonly TASK_TYPE = 'ingest-content';

  constructor(
    private readonly resourceService: ResourceService,
    private readonly vectorStore: VectorStoreService,
  ) {}

  canProcess(taskType: string): boolean {
    return taskType === this.TASK_TYPE;
  }

  async process(execution: ExecutionEntity): Promise<any> {
    const sourceType = execution.payload['sourceType'] || 'resource';
    const result = execution.result as Record<string, unknown> | null;
    const points = Array.isArray(result?.points)
      ? (result.points as VectorPointInput[])
      : null;
    if (!points) throw new Error('ingest-content result requires points');
    let payload: Record<string, unknown>;

    if (sourceType === 'resource') {
      const resourceId = Number(execution.payload['resourceId']);
      await this.vectorStore.replaceWorkspaceSource(
        'resource',
        sourceIdForResource(resourceId),
        this.projectId(execution.payload['projectId']),
        points,
      );
      await this.resourceService.update(resourceId, { status: 'ready' });

      payload = {
        type: 'ingest-content',
        message:
          `Document ingestion completed for resource with ID ${resourceId}. ` +
          'Resource is now ready.',
        resourceId,
      };
    } else if (sourceType === 'doc') {
      const docId = Number(execution.payload['docId']);
      await this.vectorStore.replaceWorkspaceSource(
        'doc',
        sourceIdForDoc(docId),
        this.projectId(execution.payload['projectId']),
        points,
      );

      payload = {
        type: 'ingest-content',
        message: `Document ingestion completed for doc ${docId}.`,
        docId,
      };
    } else if (sourceType === 'knowledge') {
      const knowledgeEntryId = Number(execution.payload['knowledgeEntryId']);
      await this.vectorStore.replaceWorkspaceSource(
        'knowledge',
        sourceIdForKnowledge(knowledgeEntryId),
        this.projectId(execution.payload['projectId']),
        points,
      );

      payload = {
        type: 'ingest-content',
        message: `Knowledge base entry ${knowledgeEntryId} ingested into RAG.`,
        knowledgeEntryId,
      };
    } else {
      throw new Error(`Unsupported ingest-content source type: ${sourceType}`);
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

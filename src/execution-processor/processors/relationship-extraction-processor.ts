import { Injectable, Logger } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { ExecutionEntity } from '../../execution/execution.entity';
import {
  AgeGraphService,
  ExtractedRelationshipInput,
  RelationshipEntityInput,
} from '../../graph/age-graph.service';

@Injectable()
export class RelationshipExtractionProcessor implements ExecutionProcessor {
  private readonly logger = new Logger(RelationshipExtractionProcessor.name);
  private readonly taskType = 'relationship-extraction';

  constructor(private readonly graphService: AgeGraphService) {}

  canProcess(taskType: string): boolean {
    return taskType === this.taskType;
  }

  async process(execution: ExecutionEntity): Promise<any> {
    const resourceId = Number(execution.payload['resourceId']);
    const projectValue = execution.payload['projectId'];
    const projectId = projectValue == null ? null : Number(projectValue);
    if (!Number.isInteger(resourceId) || resourceId <= 0) {
      throw new Error('Invalid relationship extraction resourceId');
    }
    if (projectId != null && !Number.isInteger(projectId)) {
      throw new Error('Invalid relationship extraction projectId');
    }
    const entities = this.parseEntities(execution.payload['entities']);
    const relationships = this.parseRelationships(
      (execution.result as Record<string, unknown> | null)?.relationships,
    );
    await this.graphService.replaceExtractedRelationships(
      resourceId,
      projectId,
      entities,
      relationships,
    );
    this.logger.log(
      `Stored ${relationships.length} relationships for resource ${resourceId}`,
    );
    return {
      success: true,
      resourceId,
      relationshipsExtracted: relationships.length,
      publication: {
        socketEvent: 'relationshipExtractionComplete',
        payload: { resourceId, relationships },
      },
    };
  }

  private parseEntities(value: unknown): RelationshipEntityInput[] {
    if (!Array.isArray(value) || value.length < 2) {
      throw new Error('Relationship extraction requires known entities');
    }
    return value.map((entry) => {
      if (!entry || typeof entry !== 'object') {
        throw new Error('Invalid relationship extraction entity');
      }
      const entity = entry as Record<string, unknown>;
      const id = Number(entity.id);
      const name = typeof entity.name === 'string' ? entity.name.trim() : '';
      const type = typeof entity.type === 'string' ? entity.type.trim() : '';
      if (!Number.isInteger(id) || id <= 0 || !name || !type) {
        throw new Error('Invalid relationship extraction entity');
      }
      return { id, name, type };
    });
  }

  private parseRelationships(value: unknown): ExtractedRelationshipInput[] {
    if (!Array.isArray(value)) {
      throw new Error('Invalid relationship extraction result');
    }
    return value.map((entry) => {
      if (!entry || typeof entry !== 'object') {
        throw new Error('Invalid extracted relationship');
      }
      const relationship = entry as Record<string, unknown>;
      const subject = this.requiredString(relationship.subject);
      const predicate = this.requiredString(relationship.predicate);
      const object = this.requiredString(relationship.object);
      const confidence = Number(relationship.confidence);
      const context = relationship.context;
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        throw new Error('Invalid extracted relationship confidence');
      }
      if (context != null && typeof context !== 'string') {
        throw new Error('Invalid extracted relationship context');
      }
      return {
        subject,
        predicate,
        object,
        confidence,
        ...(typeof context === 'string'
          ? { context: context.slice(0, 500) }
          : {}),
      };
    });
  }

  private requiredString(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(
        'Extracted relationship fields must be non-empty strings',
      );
    }
    return value.trim();
  }
}

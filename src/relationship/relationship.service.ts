import { Injectable } from '@nestjs/common';
import { ExecutionService } from '../execution/execution.service';
import { ExecutionPriority } from '../execution/execution-priority.enum';
import { ResourceService } from '../resource/resource.service';
import { EntityService } from '../entity/entity.service';
import { extractTextFromHtml } from '../utils/text';
// eslint-disable-next-line max-len
import { AgeGraphService, RelationshipGraph } from '../graph/age-graph.service';
// eslint-disable-next-line max-len
import { buildRelationshipExtractionWorkflowSteps } from '../model/relationship-extraction-workflow';

@Injectable()
export class RelationshipService {
  constructor(
    private readonly executionService: ExecutionService,
    private readonly resourceService: ResourceService,
    private readonly entityService: EntityService,
    private readonly graphService: AgeGraphService,
  ) {}

  queryAll(): Promise<RelationshipGraph> {
    return this.graphService.queryAll();
  }

  queryByResource(resourceId: number): Promise<RelationshipGraph> {
    return this.graphService.queryByResource(resourceId);
  }

  queryNeighborhood(entityNames: string[]): Promise<RelationshipGraph> {
    return this.graphService.queryNeighborhood(entityNames);
  }

  queryByProject(
    projectId: number,
    resourceIds?: number[],
  ): Promise<RelationshipGraph> {
    return this.graphService.queryByProject(projectId, resourceIds);
  }

  async createRelationship(dto: {
    subjectId: number;
    predicate: string;
    objectId: number;
    resourceId: number;
  }): Promise<{ success: true }> {
    const [subject, object, resource] = await Promise.all([
      this.entityService.findOne(dto.subjectId),
      this.entityService.findOne(dto.objectId),
      this.resourceService.findOne(dto.resourceId),
    ]);
    if (!subject || !object) {
      throw new Error(
        'Relationship endpoints must reference existing entities',
      );
    }
    if (!resource) {
      throw new Error('Relationship resource must exist');
    }
    await this.graphService.createRelationship(
      {
        id: subject.id,
        name: subject.name,
        type: subject.entityType?.name || 'UNKNOWN',
      },
      dto.predicate,
      {
        id: object.id,
        name: object.name,
        type: object.entityType?.name || 'UNKNOWN',
      },
      dto.resourceId,
      resource.project?.id,
    );
    return { success: true };
  }

  async updateRelationship(dto: {
    subjectId: number;
    predicate: string;
    objectId: number;
    newPredicate: string;
    resourceId: number;
  }): Promise<{ success: true }> {
    await this.graphService.updateRelationship(
      dto.subjectId,
      dto.predicate,
      dto.objectId,
      dto.newPredicate,
      dto.resourceId,
    );
    return { success: true };
  }

  async deleteRelationship(dto: {
    subjectId: number;
    predicate: string;
    objectId: number;
    resourceId: number;
  }): Promise<{ success: true }> {
    await this.graphService.deleteRelationship(
      dto.subjectId,
      dto.predicate,
      dto.objectId,
      dto.resourceId,
    );
    return { success: true };
  }

  async extractRelationshipsForProject(
    projectId: number,
  ): Promise<{ executionIds: string[] }> {
    const resources = await this.resourceService.findByProject(projectId);
    const executionIds: string[] = [];

    for (const resource of resources) {
      try {
        const result = await this.extractRelationships(resource.id);
        executionIds.push(result.executionId);
      } catch {
        // Resources without usable content or two confirmed entities are skipped.
      }
    }

    return { executionIds };
  }

  async extractRelationships(
    resourceId: number,
  ): Promise<{ executionId: string }> {
    const resource = await this.resourceService.findOne(resourceId);
    if (!resource) {
      throw new Error(`Resource with ID ${resourceId} not found`);
    }
    const content = await this.resourceService.getContentById(resourceId);
    if (!content) {
      throw new Error(`Resource with ID ${resourceId} has no content`);
    }
    const entities = await this.entityService.findByResourceId(resourceId);
    if (entities.length < 2) {
      throw new Error(
        `Resource with ID ${resourceId} needs at least two confirmed entities`,
      );
    }
    const projectId = resource.project?.id ?? null;
    const workflowEntities = entities.map((entity) => ({
      id: entity.id,
      name: entity.name,
      type: entity.entityType?.name || 'UNKNOWN',
    }));
    const steps = buildRelationshipExtractionWorkflowSteps(
      extractTextFromHtml(content),
      workflowEntities,
    );
    const execution = await this.executionService.create(
      'relationship-extraction',
      ExecutionPriority.NORMAL,
      {
        resourceId,
        projectId,
        entities: workflowEntities,
        chunkCount: steps.length - 1,
      },
      { steps },
    );
    return { executionId: execution.executionId };
  }

  async deleteByResource(resourceId: number): Promise<{ success: true }> {
    await this.graphService.deleteByResource(resourceId);
    return { success: true };
  }
}

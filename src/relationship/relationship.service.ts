import { Injectable } from '@nestjs/common';
import { ExecutionService } from 'src/execution/execution.service';
import { ExecutionPriority } from 'src/execution/execution-priority.enum';
import { ResourceService } from 'src/resource/resource.service';
import { EntityService } from 'src/entity/entity.service';
import { extractTextFromHtml } from 'src/utils/text';

@Injectable()
export class RelationshipService {
  constructor(
    private readonly executionService: ExecutionService,
    private readonly resourceService: ResourceService,
    private readonly entityService: EntityService,
  ) {}

  async queryAll(requestId?: string): Promise<{ executionId: string }> {
    const execution = await this.executionService.create(
      'relationship-query',
      ExecutionPriority.HIGH,
      {
        query_type: 'all',
        requestId,
      },
    );
    return { executionId: execution.executionId };
  }

  async queryByResource(
    resourceId: number,
    requestId?: string,
  ): Promise<{ executionId: string }> {
    const execution = await this.executionService.create(
      'relationship-query',
      ExecutionPriority.HIGH,
      {
        query_type: 'by-resource',
        resourceId,
        requestId,
      },
    );
    return { executionId: execution.executionId };
  }

  async queryNeighborhood(
    entityNames: string[],
    requestId?: string,
  ): Promise<{ executionId: string }> {
    const execution = await this.executionService.create(
      'relationship-query',
      ExecutionPriority.HIGH,
      {
        query_type: 'neighborhood',
        entityNames,
        requestId,
      },
    );
    return { executionId: execution.executionId };
  }

  async queryByProject(
    projectId: number,
    resourceIds?: number[],
    requestId?: string,
  ): Promise<{ executionId: string }> {
    const execution = await this.executionService.create(
      'relationship-query',
      ExecutionPriority.HIGH,
      {
        query_type: 'by-project',
        projectId,
        resourceIds,
        requestId,
      },
    );
    return { executionId: execution.executionId };
  }

  async createRelationship(dto: {
    subjectId: number;
    predicate: string;
    objectId: number;
    resourceId: number;
    projectId?: number;
    requestId?: string;
  }): Promise<{ executionId: string }> {
    const execution = await this.executionService.create(
      'relationship-modify',
      ExecutionPriority.NORMAL,
      {
        action: 'create',
        subjectId: dto.subjectId,
        predicate: dto.predicate,
        objectId: dto.objectId,
        resourceId: dto.resourceId,
        projectId: dto.projectId,
        requestId: dto.requestId,
      },
    );
    return { executionId: execution.executionId };
  }

  async updateRelationship(dto: {
    subjectId: number;
    predicate: string;
    objectId: number;
    newPredicate: string;
    resourceId: number;
    requestId?: string;
  }): Promise<{ executionId: string }> {
    const execution = await this.executionService.create(
      'relationship-modify',
      ExecutionPriority.NORMAL,
      {
        action: 'update',
        subjectId: dto.subjectId,
        predicate: dto.predicate,
        objectId: dto.objectId,
        newPredicate: dto.newPredicate,
        resourceId: dto.resourceId,
        requestId: dto.requestId,
      },
    );
    return { executionId: execution.executionId };
  }

  async deleteRelationship(dto: {
    subjectId: number;
    predicate: string;
    objectId: number;
    resourceId: number;
    requestId?: string;
  }): Promise<{ executionId: string }> {
    const execution = await this.executionService.create(
      'relationship-modify',
      ExecutionPriority.NORMAL,
      {
        action: 'delete',
        subjectId: dto.subjectId,
        predicate: dto.predicate,
        objectId: dto.objectId,
        resourceId: dto.resourceId,
        requestId: dto.requestId,
      },
    );
    return { executionId: execution.executionId };
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
        // Skip resources without content or entities
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
    if (entities.length === 0) {
      throw new Error(
        `Resource with ID ${resourceId} has no confirmed entities`,
      );
    }

    const projectId =
      (resource.project && (resource.project as any).id) ||
      (resource as any).projectId ||
      null;

    const plainText = extractTextFromHtml(content)
      .map((t) => t.text)
      .join('\n');

    const execution = await this.executionService.create(
      'relationship-extraction',
      ExecutionPriority.NORMAL,
      {
        resourceId,
        projectId,
        text: plainText,
        entities: entities.map((e) => ({
          id: e.id,
          name: e.name,
          type: e.entityType?.name || 'UNKNOWN',
        })),
      },
    );
    return { executionId: execution.executionId };
  }

  async deleteByResource(
    resourceId: number,
    requestId?: string,
  ): Promise<{ executionId: string }> {
    const execution = await this.executionService.create(
      'relationship-modify',
      ExecutionPriority.NORMAL,
      {
        action: 'delete-by-resource',
        resourceId,
        requestId,
      },
    );
    return { executionId: execution.executionId };
  }
}

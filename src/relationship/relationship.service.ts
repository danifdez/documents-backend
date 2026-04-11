import { Injectable } from '@nestjs/common';
import { JobService } from 'src/job/job.service';
import { JobPriority } from 'src/job/job-priority.enum';
import { ResourceService } from 'src/resource/resource.service';
import { EntityService } from 'src/entity/entity.service';
import { extractTextFromHtml } from 'src/utils/text';

@Injectable()
export class RelationshipService {
  constructor(
    private readonly jobService: JobService,
    private readonly resourceService: ResourceService,
    private readonly entityService: EntityService,
  ) {}

  async queryAll(requestId?: string): Promise<{ jobId: number }> {
    const job = await this.jobService.create('relationship-query', JobPriority.HIGH, {
      query_type: 'all',
      requestId,
    });
    return { jobId: job.id };
  }

  async queryByResource(
    resourceId: number,
    requestId?: string,
  ): Promise<{ jobId: number }> {
    const job = await this.jobService.create('relationship-query', JobPriority.HIGH, {
      query_type: 'by-resource',
      resourceId,
      requestId,
    });
    return { jobId: job.id };
  }

  async queryNeighborhood(
    entityNames: string[],
    requestId?: string,
  ): Promise<{ jobId: number }> {
    const job = await this.jobService.create('relationship-query', JobPriority.HIGH, {
      query_type: 'neighborhood',
      entityNames,
      requestId,
    });
    return { jobId: job.id };
  }

  async queryByProject(
    projectId: number,
    resourceIds?: number[],
    requestId?: string,
  ): Promise<{ jobId: number }> {
    const job = await this.jobService.create('relationship-query', JobPriority.HIGH, {
      query_type: 'by-project',
      projectId,
      resourceIds,
      requestId,
    });
    return { jobId: job.id };
  }

  async createRelationship(dto: {
    subjectId: number;
    predicate: string;
    objectId: number;
    resourceId: number;
    projectId?: number;
    requestId?: string;
  }): Promise<{ jobId: number }> {
    const job = await this.jobService.create('relationship-modify', JobPriority.NORMAL, {
      action: 'create',
      subjectId: dto.subjectId,
      predicate: dto.predicate,
      objectId: dto.objectId,
      resourceId: dto.resourceId,
      projectId: dto.projectId,
      requestId: dto.requestId,
    });
    return { jobId: job.id };
  }

  async updateRelationship(dto: {
    subjectId: number;
    predicate: string;
    objectId: number;
    newPredicate: string;
    resourceId: number;
    requestId?: string;
  }): Promise<{ jobId: number }> {
    const job = await this.jobService.create('relationship-modify', JobPriority.NORMAL, {
      action: 'update',
      subjectId: dto.subjectId,
      predicate: dto.predicate,
      objectId: dto.objectId,
      newPredicate: dto.newPredicate,
      resourceId: dto.resourceId,
      requestId: dto.requestId,
    });
    return { jobId: job.id };
  }

  async deleteRelationship(dto: {
    subjectId: number;
    predicate: string;
    objectId: number;
    resourceId: number;
    requestId?: string;
  }): Promise<{ jobId: number }> {
    const job = await this.jobService.create('relationship-modify', JobPriority.NORMAL, {
      action: 'delete',
      subjectId: dto.subjectId,
      predicate: dto.predicate,
      objectId: dto.objectId,
      resourceId: dto.resourceId,
      requestId: dto.requestId,
    });
    return { jobId: job.id };
  }

  async extractRelationshipsForProject(projectId: number): Promise<{ jobIds: number[] }> {
    const resources = await this.resourceService.findByProject(projectId);
    const jobIds: number[] = [];

    for (const resource of resources) {
      try {
        const result = await this.extractRelationships(resource.id);
        jobIds.push(result.jobId);
      } catch {
        // Skip resources without content or entities
      }
    }

    return { jobIds };
  }

  async extractRelationships(resourceId: number): Promise<{ jobId: number }> {
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
      throw new Error(`Resource with ID ${resourceId} has no confirmed entities`);
    }

    const projectId =
      (resource.project && (resource.project as any).id) ||
      (resource as any).projectId ||
      null;

    const plainText = extractTextFromHtml(content)
      .map((t) => t.text)
      .join('\n');

    const job = await this.jobService.create(
      'relationship-extraction',
      JobPriority.NORMAL,
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
    return { jobId: job.id };
  }

  async deleteByResource(
    resourceId: number,
    requestId?: string,
  ): Promise<{ jobId: number }> {
    const job = await this.jobService.create('relationship-modify', JobPriority.NORMAL, {
      action: 'delete-by-resource',
      resourceId,
      requestId,
    });
    return { jobId: job.id };
  }
}

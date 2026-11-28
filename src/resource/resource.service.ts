import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResourceEntity } from './resource.entity';
import { EntityEntity } from '../entity/entity.entity';
import { AuthorEntity } from '../author/author.entity';
import { FileStorageService } from '../file-storage/file-storage.service';
import { ExecutionService } from '../execution/execution.service';
import { ExecutionAccessScope } from '../execution/execution.types';
import { ExecutionPriority } from '../execution/execution-priority.enum';
import { AlreadyExistException } from '../common/exceptions/already-exist.exception';
import { RESOURCE_TYPE_WEBPAGE } from '../common/constants';
import { globalSimilaritySearch } from '../common/global-search';
import { extractTextFromHtml } from '../utils/text';
import { buildDateExtractionWorkflowSteps } from '../model/date-extraction-workflow';
import { AgeGraphService } from '../graph/age-graph.service';

function stripMarkup(html: string): string {
  const parts: string[] = [];
  let offset = 0;
  for (;;) {
    const opening = html.indexOf('<', offset);
    const closing = opening < 0 ? -1 : html.indexOf('>', opening + 1);
    if (closing < 0) break;
    parts.push(html.slice(offset, opening), ' ');
    offset = closing + 1;
  }
  parts.push(html.slice(offset));
  return parts.join('');
}

@Injectable()
export class ResourceService {
  constructor(
    @InjectRepository(ResourceEntity)
    private readonly repo: Repository<ResourceEntity>,
    private readonly fileStorageService: FileStorageService,
    private readonly executionService: ExecutionService,
    private readonly graphService: AgeGraphService,
  ) {}

  async findOne(id: number): Promise<ResourceEntity | null> {
    return await this.repo.findOne({
      select: {
        id: true,
        name: true,
        title: true,
        path: true,
        project: true,
        summary: true,
        keyPoints: true,
        keywords: true,
        originalName: true,
        publicationDate: true,
        type: true,
        license: true,
        fileSize: true,
        pages: true,
        uploadDate: true,
        url: true,
        language: true,
        mimeType: true,
        status: true,
        archivedAt: true,
        createdAt: true,
        updatedAt: true,
      },
      where: { id },
      relations: { project: true, authors: true },
    });
  }

  async getContentById(id: number): Promise<string | null> {
    const resource = await this.repo.findOne({
      select: { content: true },
      where: { id },
    });
    return resource?.content ?? null;
  }

  async getTranslatedContentById(id: number): Promise<string | null> {
    const resource = await this.repo.findOne({
      select: { translatedContent: true },
      where: { id },
    });
    return resource?.translatedContent ?? null;
  }

  async create(resource: Partial<ResourceEntity>): Promise<ResourceEntity> {
    const created = this.repo.create(resource);
    return await this.repo.save(created);
  }

  async findAllWithProjects(): Promise<ResourceEntity[]> {
    return await this.repo
      .createQueryBuilder('resource')
      .select([
        'resource.id',
        'resource.name',
        'resource.title',
        'resource.mimeType',
        'resource.type',
        'resource.status',
        'resource.publicationDate',
        'resource.url',
        'resource.createdAt',
      ])
      .leftJoinAndSelect('resource.project', 'project')
      .where('resource.projectId IS NOT NULL')
      .orderBy('project.name', 'ASC')
      .addOrderBy('resource.createdAt', 'DESC')
      .getMany();
  }

  async findByProject(projectId: number): Promise<ResourceEntity[]> {
    return await this.repo.find({
      select: {
        id: true,
        name: true,
        title: true,
        mimeType: true,
        originalName: true,
        type: true,
        status: true,
        createdAt: true,
      },
      where: { project: { id: projectId } },
      order: { createdAt: 'DESC' },
    });
  }

  async findByIds(
    ids: number[],
  ): Promise<Pick<ResourceEntity, 'id' | 'name' | 'title' | 'mimeType'>[]> {
    if (!ids.length) return [];
    return await this.repo
      .createQueryBuilder('resource')
      .select([
        'resource.id',
        'resource.name',
        'resource.title',
        'resource.mimeType',
      ])
      .whereInIds(ids)
      .getMany();
  }

  async findByThread(threadId: number): Promise<ResourceEntity[]> {
    return await this.repo.find({
      select: {
        id: true,
        name: true,
        title: true,
        mimeType: true,
        originalName: true,
        type: true,
        status: true,
        createdAt: true,
      },
      where: { thread: { id: threadId } },
      order: { createdAt: 'DESC' },
    });
  }

  async assignToThread(
    resourceId: number,
    threadId: number,
  ): Promise<ResourceEntity | null> {
    const resource = await this.repo.findOneBy({ id: resourceId });
    if (!resource) return null;
    resource.thread = { id: threadId } as any;
    return await this.repo.save(resource);
  }

  async findPending(): Promise<ResourceEntity[]> {
    return await this.repo
      .createQueryBuilder('resource')
      .select([
        'resource.id',
        'resource.name',
        'resource.title',
        'resource.mimeType',
        'resource.originalName',
        'resource.type',
        'resource.status',
        'resource.createdAt',
      ])
      .where('resource.projectId IS NULL')
      .orderBy('resource.createdAt', 'DESC')
      .getMany();
  }

  async assignToProject(
    resourceId: number,
    projectId: number,
  ): Promise<ResourceEntity | null> {
    const resource = await this.repo.findOneBy({ id: resourceId });
    if (!resource) return null;
    resource.project = { id: projectId } as any;
    return await this.repo.save(resource);
  }

  async search(query: string): Promise<ResourceEntity[]> {
    if (!query?.trim()) return [];
    return await this.repo
      .createQueryBuilder('r')
      .where('r.name ILIKE :q', { q: `%${query}%` })
      .orderBy('r.createdAt', 'DESC')
      .limit(10)
      .getMany();
  }

  async findByHash(hash: string): Promise<ResourceEntity | null> {
    return await this.repo.findOne({ where: { hash } });
  }

  // El navegador busca por la dirección de la página para saber si lo que está
  // viendo ya es un recurso del proyecto.
  async findByUrl(
    url: string,
    projectId?: number,
  ): Promise<ResourceEntity | null> {
    const where: Record<string, any> = { url };
    if (projectId) {
      where.project = { id: projectId };
    }
    return await this.repo.findOne({
      where,
      order: { id: 'DESC' },
      relations: { project: true },
    });
  }

  async findByEntityId(entityId: number): Promise<ResourceEntity[]> {
    return await this.repo
      .createQueryBuilder('resource')
      .innerJoin('resource.entities', 'entity')
      .where('entity.id = :entityId', { entityId })
      .getMany();
  }

  async findByEntityName(entityName: string): Promise<ResourceEntity[]> {
    return await this.repo
      .createQueryBuilder('resource')
      .innerJoin('resource.entities', 'entity')
      .where('entity.name ILIKE :entityName', { entityName: `%${entityName}%` })
      .getMany();
  }

  async update(
    id: number,
    resource: Partial<any>,
  ): Promise<ResourceEntity | null> {
    let anchorChanged = false;
    let newAnchor: string | null = null;
    if (Object.hasOwn(resource, 'publicationDate')) {
      const before = await this.repo.findOne({
        select: { id: true, publicationDate: true },
        where: { id },
      });
      const oldAnchor = before?.publicationDate
        ? String(before.publicationDate).slice(0, 10)
        : null;
      newAnchor = resource.publicationDate
        ? String(resource.publicationDate).slice(0, 10)
        : null;
      anchorChanged = oldAnchor !== newAnchor;
    }

    const existing = await this.repo.preload({ id, ...resource });
    if (!existing) return null;
    const saved = await this.repo.save(existing);

    if (anchorChanged) {
      const content = await this.getContentById(id);
      if (content) {
        const steps = buildDateExtractionWorkflowSteps(
          extractTextFromHtml(content),
          saved.language || null,
          newAnchor,
        );
        await this.executionService.create(
          'date-extraction',
          ExecutionPriority.NORMAL,
          {
            resourceId: id,
          },
          { steps },
        );
      }
    }

    return saved;
  }

  async remove(id: number): Promise<ResourceEntity | null> {
    const r = await this.repo.findOneBy({ id });
    if (!r) return null;
    await this.repo.remove(r);
    return r;
  }

  async globalSearch(searchTerm: string, projectId?: number): Promise<any[]> {
    return await globalSimilaritySearch(this.repo, searchTerm, projectId, {
      alias: 'r',
      select: ['r.id', 'r.name', 'r.title', 'r.content', 'r.translatedContent'],
      scoreColumn: 'r.content',
      searchColumns: ['r.content', 'r.name', 'r.translated_content'],
      projectIdColumn: 'r.projectId',
    });
  }

  async addEntityToResource(
    resourceId: number,
    entity: EntityEntity,
  ): Promise<void> {
    const existing = await this.repo.query(
      'SELECT 1 FROM resource_entities WHERE resource_id = $1 AND entity_id = $2',
      [resourceId, entity.id],
    );

    if (existing.length === 0) {
      await this.repo.query(
        'INSERT INTO resource_entities (resource_id, entity_id, created_at) VALUES ($1, $2, NOW())',
        [resourceId, entity.id],
      );
    }
  }

  async removeEntityFromResource(
    resourceId: number,
    entityId: number,
  ): Promise<void> {
    await this.repo.query(
      'DELETE FROM resource_entities WHERE resource_id = $1 AND entity_id = $2',
      [resourceId, entityId],
    );
  }

  async resourceExists(id: number): Promise<boolean> {
    const count = await this.repo.count({ where: { id } });
    return count > 0;
  }

  async addAuthorToResource(
    resourceId: number,
    author: AuthorEntity,
  ): Promise<void> {
    const existing = await this.repo.query(
      'SELECT 1 FROM resource_authors WHERE resource_id = $1 AND author_id = $2',
      [resourceId, author.id],
    );

    if (existing.length === 0) {
      await this.repo.query(
        'INSERT INTO resource_authors (resource_id, author_id, created_at) VALUES ($1, $2, NOW())',
        [resourceId, author.id],
      );
    }
  }

  async removeAuthorFromResource(
    resourceId: number,
    authorId: number,
  ): Promise<void> {
    await this.repo.query(
      'DELETE FROM resource_authors WHERE resource_id = $1 AND author_id = $2',
      [resourceId, authorId],
    );
  }

  async clearResourceAuthors(resourceId: number): Promise<void> {
    await this.repo.query(
      'DELETE FROM resource_authors WHERE resource_id = $1',
      [resourceId],
    );
  }

  async getEntitiesByResourceId(resourceId: number): Promise<any[]> {
    const entityRepo = this.repo.manager.getRepository(EntityEntity);
    return await entityRepo
      .createQueryBuilder('entity')
      .innerJoin('resource_entities', 're', 're.entity_id = entity.id')
      .where('re.resource_id = :resourceId', { resourceId })
      .leftJoinAndSelect('entity.entityType', 'entityType')
      .select([
        'entity.id',
        'entity.name',
        'entity.description',
        'entity.translations',
        'entity.aliases',
        'entityType.id',
        'entityType.name',
      ])
      .getMany();
  }

  async confirmExtraction(
    id: number,
    scope: ExecutionAccessScope,
  ): Promise<{ success: boolean; message: string; executionId: string }> {
    const resource = await this.findOne(id);
    if (!resource) {
      throw new NotFoundException('Resource not found');
    }
    if (resource.status !== 'extracted') {
      throw new HttpException(
        'Resource is not in extracted state',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.update(id, { status: 'confirmed_extraction' });

    const content = await this.getContentById(id);
    const samples = this.extractTextSamples(content);
    const execution = await this.executionService.create(
      'detect-language',
      ExecutionPriority.NORMAL,
      {
        resourceId: id,
        samples,
      },
      { ownerPrincipal: scope.ownerPrincipal },
    );

    return {
      success: true,
      executionId: execution.executionId,
      message:
        'Resource extraction confirmed and language detection execution created',
    };
  }

  async uploadAndProcess(
    scope: ExecutionAccessScope,
    file: Express.Multer.File,
    resourceData: Partial<ResourceEntity> & {
      projectId?: string;
      threadId?: string;
    },
  ): Promise<{
    success: boolean;
    resourceId: number;
    executionId: string | null;
  }> {
    const hash = this.fileStorageService.calculateHash(file.buffer);

    const existingResource = await this.findByHash(hash);
    if (existingResource) {
      throw new AlreadyExistException(
        'File',
        'File with the same content already exists',
      );
    }

    const result = await this.fileStorageService.storeFile(
      hash,
      file.buffer,
      file.originalname,
    );

    const resourceToCreate: any = {
      name: resourceData.name || file.originalname,
      project: resourceData.projectId
        ? { id: Number(resourceData.projectId) }
        : null,
      thread: resourceData.threadId
        ? { id: Number(resourceData.threadId) }
        : null,
      hash: hash,
      mimeType: file.mimetype,
      originalName: resourceData.originalName || file.originalname,
      path: result.relativePath,
      uploadDate: new Date(),
      fileSize: file.size,
    };

    if (resourceData.type && resourceData.type === 'webpage') {
      resourceToCreate.type = RESOURCE_TYPE_WEBPAGE;
    }

    if (resourceData.url) {
      resourceToCreate.url = resourceData.url;
    }

    if (resourceData.relatedTo) {
      resourceToCreate.relatedTo = resourceData.relatedTo;
    }

    const resourceCreated = await this.create(resourceToCreate);
    let executionId: string | null = null;
    if (!file.mimetype.startsWith('image/')) {
      const execution = await this.executionService.create(
        'document-extraction',
        ExecutionPriority.NORMAL,
        {
          hash: result.hash,
          extension: result.extension,
          resourceId: resourceCreated.id,
        },
        {
          ownerPrincipal: scope.ownerPrincipal,
          inputArtifacts: [
            {
              role: 'document',
              kind: 'source_document',
              mediaType: file.mimetype,
              body: file.buffer,
            },
          ],
        },
      );
      executionId = execution.executionId;
    }

    return { success: true, resourceId: resourceCreated.id, executionId };
  }

  async getFileBuffer(
    id: number,
  ): Promise<{ buffer: Buffer; resource: ResourceEntity }> {
    const resource = await this.findOne(id);
    if (!resource?.path) {
      throw new NotFoundException('File not found');
    }

    const buffer = resource.archivedAt
      ? await this.fileStorageService.getFileFromArchive(resource.path)
      : await this.fileStorageService.getFile(resource.path);
    if (!buffer) {
      throw new NotFoundException('File not found');
    }

    return { buffer, resource };
  }

  async removeWithFile(id: number): Promise<void> {
    await this.graphService.deleteByResource(id);
    const resource = await this.remove(id);
    if (resource?.path) {
      await this.fileStorageService.deleteFile(resource.path);
    }
  }

  private extractTextSamples(html: string): string[] {
    try {
      const fullText = stripMarkup(html).replace(/\s+/g, ' ').trim();

      const samples: string[] = [];

      if (fullText.length <= 400) {
        const midpoint = Math.floor(fullText.length / 2);
        samples.push(
          fullText.substring(0, Math.min(200, midpoint)).trim(),
          fullText
            .substring(
              midpoint,
              midpoint + Math.min(200, fullText.length - midpoint),
            )
            .trim(),
        );
      } else {
        for (let i = 0; i < 2; i++) {
          const maxStart = fullText.length - 200;
          const start = Math.floor(Math.random() * maxStart);
          const end = Math.min(start + 200, fullText.length);
          samples.push(fullText.substring(start, end).trim());
        }
      }

      return samples;
    } catch {
      return [];
    }
  }
}

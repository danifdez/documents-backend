import { HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResourceEntity } from './resource.entity';
import { EntityEntity } from '../entity/entity.entity';
import { AuthorEntity } from '../author/author.entity';
import { FileStorageService } from '../file-storage/file-storage.service';
import { JobService } from '../job/job.service';
import { JobPriority } from '../job/job-priority.enum';
import { AlreadyExistException } from '../common/exceptions/already-exist.exception';
import { DEFAULT_PAGE_SIZE, RESOURCE_TYPE_WEBPAGE } from '../common/constants';

@Injectable()
export class ResourceService {
  private readonly logger = new Logger(ResourceService.name);

  constructor(
    @InjectRepository(ResourceEntity)
    private readonly repo: Repository<ResourceEntity>,
    private readonly fileStorageService: FileStorageService,
    private readonly jobService: JobService,
  ) { }

  async findOne(id: number): Promise<ResourceEntity | null> {
    return await this.repo.findOne({
      select: ['id', 'name', 'title', 'path', 'project', 'summary', 'keyPoints', 'keywords', 'originalName', 'publicationDate', 'type', 'license', 'fileSize', 'pages', 'uploadDate', 'url', 'language', 'mimeType', 'status', 'createdAt', 'updatedAt'],
      where: { id },
      relations: ['project'],
    });
  }

  async getContentById(id: number): Promise<string | null> {
    const resource = await this.repo.findOne({
      select: ['content'],
      where: { id },
    });
    return resource?.content ?? null;
  }

  async getTranslatedContentById(id: number): Promise<string | null> {
    const resource = await this.repo.findOne({
      select: ['translatedContent'],
      where: { id },
    });
    return resource?.translatedContent ?? null;
  }

  async getWorkingContentById(id: number): Promise<string | null> {
    const resource = await this.repo.findOne({
      select: ['workingContent'],
      where: { id },
    });
    return resource?.workingContent ?? null;
  }

  async create(resource: Partial<ResourceEntity>): Promise<ResourceEntity> {
    const created = this.repo.create(resource);
    return await this.repo.save(created);
  }

  async findAllWithProjects(): Promise<ResourceEntity[]> {
    return await this.repo
      .createQueryBuilder('resource')
      .select(['resource.id', 'resource.name', 'resource.title', 'resource.mimeType', 'resource.type', 'resource.status', 'resource.publicationDate', 'resource.url', 'resource.createdAt'])
      .leftJoinAndSelect('resource.project', 'project')
      .where('resource.projectId IS NOT NULL')
      .orderBy('project.name', 'ASC')
      .addOrderBy('resource.createdAt', 'DESC')
      .getMany();
  }

  async findByProject(projectId: number): Promise<ResourceEntity[]> {
    return await this.repo.find({
      select: ['id', 'name', 'title', 'mimeType', 'originalName', 'type', 'status', 'createdAt'],
      where: { project: { id: projectId } },
      order: { createdAt: 'DESC' }
    });
  }

  async findByThread(threadId: number): Promise<ResourceEntity[]> {
    return await this.repo.find({
      select: ['id', 'name', 'title', 'mimeType', 'originalName', 'type', 'status', 'createdAt'],
      where: { thread: { id: threadId } },
      order: { createdAt: 'DESC' }
    });
  }

  async assignToThread(resourceId: number, threadId: number): Promise<ResourceEntity | null> {
    const resource = await this.repo.findOneBy({ id: resourceId });
    if (!resource) return null;
    resource.thread = { id: threadId } as any;
    return await this.repo.save(resource);
  }

  async findPending(): Promise<ResourceEntity[]> {
    return await this.repo.createQueryBuilder('resource')
      .select(['resource.id', 'resource.name', 'resource.title', 'resource.mimeType', 'resource.originalName', 'resource.type', 'resource.status', 'resource.createdAt'])
      .where('resource.projectId IS NULL')
      .orderBy('resource.createdAt', 'DESC')
      .getMany();
  }

  async assignToProject(resourceId: number, projectId: number): Promise<ResourceEntity | null> {
    const resource = await this.repo.findOneBy({ id: resourceId });
    if (!resource) return null;
    resource.project = { id: projectId } as any;
    return await this.repo.save(resource);
  }

  async search(query: string): Promise<ResourceEntity[]> {
    if (!query || !query.trim()) return [];
    return await this.repo.createQueryBuilder('r').where('r.name ILIKE :q', { q: `%${query}%` }).orderBy('r.createdAt', 'DESC').limit(10).getMany();
  }

  async findByHash(hash: string): Promise<ResourceEntity | null> {
    return await this.repo.findOne({ where: { hash } });
  }

  async findByEntityId(entityId: number): Promise<ResourceEntity[]> {
    return await this.repo.createQueryBuilder('resource')
      .innerJoin('resource.entities', 'entity')
      .where('entity.id = :entityId', { entityId })
      .getMany();
  }

  async findByEntityName(entityName: string): Promise<ResourceEntity[]> {
    return await this.repo.createQueryBuilder('resource')
      .innerJoin('resource.entities', 'entity')
      .where('entity.name ILIKE :entityName', { entityName: `%${entityName}%` })
      .getMany();
  }

  async update(id: number, resource: Partial<any>): Promise<ResourceEntity | null> {
    const existing = await this.repo.preload({ id, ...resource });
    if (!existing) return null;
    return await this.repo.save(existing);
  }

  async remove(id: number): Promise<ResourceEntity | null> {
    const r = await this.repo.findOneBy({ id });
    if (!r) return null;
    await this.repo.remove(r);
    return r;
  }

  async globalSearch(searchTerm: string, projectId?: number): Promise<any[]> {
    if (!searchTerm || !searchTerm.trim()) return [];
    const qb = this.repo.createQueryBuilder('r')
      .select(['r.id', 'r.name', 'r.title', 'r.content', 'r.translatedContent'])
      .addSelect('similarity(unaccent(r.content), unaccent(:s))', 'score')
      .where('unaccent(r.content) ILIKE unaccent(:q) OR unaccent(r.name) ILIKE unaccent(:q) OR unaccent(r.translated_content) ILIKE unaccent(:q)', { q: `%${searchTerm}%` })
      .setParameter('s', searchTerm);
    if (projectId) {
      qb.andWhere('r.projectId = :projectId', { projectId });
    }
    return await qb.orderBy('score', 'DESC').limit(DEFAULT_PAGE_SIZE).getRawMany();
  }

  async clearResourceEntities(resourceId: number): Promise<void> {
    await this.repo.query(
      'DELETE FROM resource_entities WHERE resource_id = $1',
      [resourceId]
    );
  }

  async addEntityToResource(resourceId: number, entity: EntityEntity): Promise<void> {
    const existing = await this.repo.query(
      'SELECT 1 FROM resource_entities WHERE resource_id = $1 AND entity_id = $2',
      [resourceId, entity.id]
    );

    if (existing.length === 0) {
      await this.repo.query(
        'INSERT INTO resource_entities (resource_id, entity_id, created_at) VALUES ($1, $2, NOW())',
        [resourceId, entity.id]
      );
    }
  }

  async removeEntityFromResource(resourceId: number, entityId: number): Promise<void> {
    await this.repo.query(
      'DELETE FROM resource_entities WHERE resource_id = $1 AND entity_id = $2',
      [resourceId, entityId]
    );
  }

  async resourceExists(id: number): Promise<boolean> {
    const count = await this.repo.count({ where: { id } });
    return count > 0;
  }

  async addAuthorToResource(resourceId: number, author: AuthorEntity): Promise<void> {
    const existing = await this.repo.query(
      'SELECT 1 FROM resource_authors WHERE resource_id = $1 AND author_id = $2',
      [resourceId, author.id]
    );

    if (existing.length === 0) {
      await this.repo.query(
        'INSERT INTO resource_authors (resource_id, author_id, created_at) VALUES ($1, $2, NOW())',
        [resourceId, author.id]
      );
    }
  }

  async removeAuthorFromResource(resourceId: number, authorId: number): Promise<void> {
    await this.repo.query(
      'DELETE FROM resource_authors WHERE resource_id = $1 AND author_id = $2',
      [resourceId, authorId]
    );
  }

  async clearResourceAuthors(resourceId: number): Promise<void> {
    await this.repo.query(
      'DELETE FROM resource_authors WHERE resource_id = $1',
      [resourceId]
    );
  }

  async findByAuthorId(authorId: number): Promise<ResourceEntity[]> {
    return await this.repo.createQueryBuilder('resource')
      .innerJoin('resource.authors', 'author')
      .where('author.id = :authorId', { authorId })
      .getMany();
  }

  async findByAuthorName(authorName: string): Promise<ResourceEntity[]> {
    return await this.repo.createQueryBuilder('resource')
      .innerJoin('resource.authors', 'author')
      .where('author.name ILIKE :authorName', { authorName: `%${authorName}%` })
      .getMany();
  }

  async getEntitiesByResourceId(resourceId: number): Promise<any[]> {
    const entityRepo = this.repo.manager.getRepository(EntityEntity);
    return await entityRepo.createQueryBuilder('entity')
      .innerJoin('resource_entities', 're', 're.entity_id = entity.id')
      .where('re.resource_id = :resourceId', { resourceId })
      .leftJoinAndSelect('entity.entityType', 'entityType')
      .select(['entity.id', 'entity.name', 'entity.description', 'entity.translations', 'entity.aliases', 'entityType.id', 'entityType.name'])
      .getMany();
  }

  async confirmExtraction(id: number): Promise<{ success: boolean; message: string }> {
    const resource = await this.findOne(id);
    if (!resource) {
      throw new NotFoundException('Resource not found');
    }
    if (resource.status !== 'extracted') {
      throw new HttpException('Resource is not in extracted state', HttpStatus.BAD_REQUEST);
    }

    await this.update(id, { status: 'confirmed_extraction' });

    const content = await this.getContentById(id);
    const samples = this.extractTextSamples(content);
    await this.jobService.create('detect-language', JobPriority.NORMAL, {
      resourceId: id,
      samples,
    });

    return {
      success: true,
      message: 'Resource extraction confirmed and language detection job created',
    };
  }

  async uploadAndProcess(
    file: Express.Multer.File,
    resourceData: Partial<ResourceEntity> & { projectId?: string; threadId?: string },
  ): Promise<{ success: boolean }> {
    const hash = this.fileStorageService.calculateHash(file.buffer);

    const existingResource = await this.findByHash(hash);
    if (existingResource) {
      throw new AlreadyExistException('File', 'File with the same content already exists');
    }

    const result = await this.fileStorageService.storeFile(
      hash,
      file.buffer,
      file.originalname,
    );

    const resourceToCreate: any = {
      name: resourceData.name || file.originalname,
      project: resourceData.projectId ? { id: Number(resourceData.projectId) } : null,
      thread: resourceData.threadId ? { id: Number(resourceData.threadId) } : null,
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
    if (!file.mimetype.startsWith('image/')) {
      await this.jobService.create(
        'document-extraction',
        JobPriority.NORMAL,
        {
          hash: result.hash,
          extension: result.extension,
          resourceId: resourceCreated.id,
        },
      );
    }

    return { success: true };
  }

  async getFileBuffer(id: number): Promise<{ buffer: Buffer; resource: ResourceEntity }> {
    const resource = await this.findOne(id);
    if (!resource || !resource.path) {
      throw new NotFoundException('File not found');
    }

    const buffer = await this.fileStorageService.getFile(resource.path);
    if (!buffer) {
      throw new NotFoundException('File not found');
    }

    return { buffer, resource };
  }

  async removeWithFile(id: number): Promise<void> {
    const resource = await this.remove(id);
    if (resource && resource.path) {
      await this.fileStorageService.deleteFile(resource.path);
    }
    // Cleanup Neo4j relationships for this resource
    try {
      await this.jobService.create('relationship-modify', JobPriority.BACKGROUND, {
        action: 'delete-by-resource',
        resourceId: id,
      });
    } catch {
      // Relationship cleanup is best-effort; don't fail the delete
    }
  }

  async cleanupTempResources(maxAgeHours: number): Promise<number> {
    const threshold = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
    const tempResources = await this.repo
      .createQueryBuilder('r')
      .where('r.status = :status', { status: 'temp' })
      .andWhere('r.created_at < :threshold', { threshold })
      .getMany();

    for (const resource of tempResources) {
      await this.removeWithFile(resource.id);
    }
    return tempResources.length;
  }

  async promoteTemp(id: number): Promise<ResourceEntity> {
    const resource = await this.findOne(id);
    if (!resource) {
      throw new NotFoundException('Resource not found');
    }
    if (resource.status !== 'temp') {
      return resource;
    }

    // Move file from temp/ to permanent hash-based path
    if (resource.hash && resource.path) {
      const extension = resource.path.substring(resource.path.lastIndexOf('.'));
      const permanentRelative = this.fileStorageService.getRelativePath(resource.hash, extension);
      await this.fileStorageService.moveFile(resource.path, permanentRelative);
      resource.path = permanentRelative;
    }

    resource.status = 'ready';
    return await this.repo.save(resource);
  }

  private extractTextSamples(html: string): string[] {
    try {
      const fullText = html
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const samples: string[] = [];

      if (fullText.length <= 400) {
        const midpoint = Math.floor(fullText.length / 2);
        samples.push(fullText.substring(0, Math.min(200, midpoint)).trim());
        samples.push(
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
    } catch (error) {
      return [];
    }
  }
}

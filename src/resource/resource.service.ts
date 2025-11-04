import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResourceEntity } from './resource.entity';
import { EntityEntity } from '../entity/entity.entity';
import { AuthorEntity } from '../author/author.entity';

@Injectable()
export class ResourceService {
  constructor(
    @InjectRepository(ResourceEntity)
    private readonly repo: Repository<ResourceEntity>,
  ) { }

  async findOne(id: number): Promise<ResourceEntity | null> {
    try {
      const resource = await this.repo.findOne({
        select: ['id', 'name', 'title', 'path', 'project', 'summary', 'keyPoints', 'originalName', 'publicationDate', 'type', 'license', 'fileSize', 'pages', 'uploadDate', 'url', 'language', 'mimeType', 'confirmationStatus', 'createdAt', 'updatedAt'],
        where: { id },
        relations: ['project'],
      });

      if (!resource) {
        return null;
      }

      return resource;
    } catch (error) {
      throw error;
    }
  }

  async getContentById(id: number): Promise<string | null> {
    try {
      const resource = await this.repo.findOne({
        select: ['content'],
        where: { id },
      });

      if (!resource) {
        return null;
      }

      return resource.content;
    } catch (error) {
      throw error;
    }
  }

  async getTranslatedContentById(id: number): Promise<string | null> {
    try {
      const resource = await this.repo.findOne({
        select: ['translatedContent'],
        where: { id },
      });

      if (!resource) {
        return null;
      }

      return resource.translatedContent;
    } catch (error) {
      throw error;
    }
  }

  async getWorkingContentById(id: number): Promise<string | null> {
    try {
      const resource = await this.repo.findOne({
        select: ['workingContent'],
        where: { id },
      });

      if (!resource) return null;
      return resource.workingContent;
    } catch (error) {
      throw error;
    }
  }

  async create(resource: Partial<ResourceEntity>): Promise<ResourceEntity> {
    const created = this.repo.create(resource);
    return await this.repo.save(created);
  }

  async findByProject(projectId: number): Promise<ResourceEntity[]> {
    return await this.repo.find({
      select: ['id', 'name', 'createdAt'],
      where: { project: { id: projectId } },
      order: { createdAt: 'DESC' },
      take: 10
    });
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

  async globalSearch(searchTerm: string): Promise<ResourceEntity[]> {
    if (!searchTerm || !searchTerm.trim()) return [];
    return await this.repo.createQueryBuilder('r')
      .where('r.content ILIKE :q OR r.name ILIKE :q', { q: `%${searchTerm}%` })
      .orderBy('similarity(r.content, :s)', 'DESC')
      .setParameter('s', searchTerm)
      .limit(50)
      .getMany();
  }

  async clearResourceEntities(resourceId: number): Promise<void> {
    try {
      await this.repo.query(
        'DELETE FROM resource_entities WHERE resource_id = $1',
        [resourceId]
      );
    } catch (error) {
      console.error(`ResourceService.clearResourceEntities: Error:`, error);
      throw error;
    }
  }

  async addEntityToResource(resourceId: number, entity: EntityEntity): Promise<void> {
    try {
      // Check if relationship already exists using raw SQL
      const existing = await this.repo.query(
        'SELECT 1 FROM resource_entities WHERE resource_id = $1 AND entity_id = $2',
        [resourceId, entity.id]
      );

      if (existing.length === 0) {
        // Insert the relationship using raw SQL
        await this.repo.query(
          'INSERT INTO resource_entities (resource_id, entity_id, created_at) VALUES ($1, $2, NOW())',
          [resourceId, entity.id]
        );
      }
    } catch (error) {
      throw error;
    }
  }

  async removeEntityFromResource(resourceId: number, entityId: number): Promise<void> {
    try {
      await this.repo.query(
        'DELETE FROM resource_entities WHERE resource_id = $1 AND entity_id = $2',
        [resourceId, entityId]
      );
    } catch (error) {
      throw error;
    }
  }

  async resourceExists(id: number): Promise<boolean> {
    try {
      const count = await this.repo.count({ where: { id } });
      return count > 0;
    } catch (error) {
      return false;
    }
  }

  async addAuthorToResource(resourceId: number, author: AuthorEntity): Promise<void> {
    try {
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
    } catch (error) {
      throw error;
    }
  }

  async removeAuthorFromResource(resourceId: number, authorId: number): Promise<void> {
    try {
      await this.repo.query(
        'DELETE FROM resource_authors WHERE resource_id = $1 AND author_id = $2',
        [resourceId, authorId]
      );
    } catch (error) {
      throw error;
    }
  }

  async clearResourceAuthors(resourceId: number): Promise<void> {
    try {
      await this.repo.query(
        'DELETE FROM resource_authors WHERE resource_id = $1',
        [resourceId]
      );
    } catch (error) {
      throw error;
    }
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
    // Fetch EntityEntity objects related to the resource and include their entityType
    try {
      const entityRepo = this.repo.manager.getRepository(EntityEntity);
      const entities = await entityRepo.createQueryBuilder('entity')
        // join the junction table directly to avoid issues with inverse JoinTable metadata
        .innerJoin('resource_entities', 're', 're.entity_id = entity.id')
        .where('re.resource_id = :resourceId', { resourceId })
        .leftJoinAndSelect('entity.entityType', 'entityType')
        .select(['entity.id', 'entity.name', 'entity.translations', 'entity.aliases', 'entityType.id', 'entityType.name'])
        .getMany();

      return entities;
    } catch (error) {
      throw error;
    }
  }
}

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResourceEntity } from './resource.entity';
import { EntityEntity } from '../entity/entity.entity';

@Injectable()
export class ResourceService {
  constructor(
    @InjectRepository(ResourceEntity)
    private readonly repo: Repository<ResourceEntity>,
  ) { }

  async findOne(id: number): Promise<ResourceEntity | null> {
    try {
      const resource = await this.repo.findOne({
        where: { id },
        relations: ['entities', 'entities.entityType']
      });

      if (!resource) {
        console.log(`ResourceService.findOne: No resource found with id ${id}`);
        return null;
      }

      return resource;
    } catch (error) {
      console.error(`ResourceService.findOne: Error finding resource ${id}:`, error);
      throw error;
    }
  }

  async create(resource: Partial<ResourceEntity>): Promise<ResourceEntity> {
    const created = this.repo.create(resource);
    return await this.repo.save(created);
  }

  async findByProject(projectId: number): Promise<ResourceEntity[]> {
    return await this.repo.find({
      where: { project: { id: projectId } },
      relations: ['entities', 'entities.entityType'],
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
    console.log(`ResourceService.clearResourceEntities: Starting for resource ${resourceId}`);

    try {
      // Use raw SQL to delete relationships
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
    console.log(`ResourceService.addEntityToResource: Adding entity ${entity.name} (id: ${entity.id}) to resource ${resourceId}`);

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
      } else {
        console.log(`ResourceService.addEntityToResource: Entity ${entity.name} already exists on resource ${resourceId}`);
      }
    } catch (error) {
      console.error(`ResourceService.addEntityToResource: Error:`, error);
      throw error;
    }
  }

  async removeEntityFromResource(resourceId: number, entityId: number): Promise<void> {
    console.log(`ResourceService.removeEntityFromResource: Removing entity ${entityId} from resource ${resourceId}`);

    try {
      await this.repo.query(
        'DELETE FROM resource_entities WHERE resource_id = $1 AND entity_id = $2',
        [resourceId, entityId]
      );
    } catch (error) {
      console.error(`ResourceService.removeEntityFromResource: Error:`, error);
      throw error;
    }
  }

  async resourceExists(id: number): Promise<boolean> {
    try {
      const count = await this.repo.count({ where: { id } });
      return count > 0;
    } catch (error) {
      console.error(`ResourceService.resourceExists: Error checking if resource ${id} exists:`, error);
      return false;
    }
  }
}

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EntityEntity } from './entity.entity';
import { CreateEntityDto, UpdateEntityDto } from './dto/entity.dto';
import { EntityTypeService } from '../entity-type/entity-type.service';

@Injectable()
export class EntityService {
    constructor(
        @InjectRepository(EntityEntity)
        private readonly repository: Repository<EntityEntity>,
        private readonly entityTypeService: EntityTypeService,
    ) { }

    async findAll(): Promise<EntityEntity[]> {
        return await this.repository.find({
            relations: ['entityType'],
            order: { name: 'ASC' }
        });
    }

    async findOne(id: number): Promise<EntityEntity | null> {
        return await this.repository.findOne({
            where: { id },
            relations: ['entityType', 'resources']
        });
    }

    async findByName(name: string): Promise<EntityEntity | null> {
        return await this.repository.findOne({
            where: { name },
            relations: ['entityType']
        });
    }

    async findByNameAndType(name: string, entityTypeId: number): Promise<EntityEntity | null> {
        return await this.repository.findOne({
            where: {
                name,
                entityType: { id: entityTypeId }
            },
            relations: ['entityType']
        });
    }

    async searchByName(searchTerm: string): Promise<EntityEntity[]> {
        if (!searchTerm || searchTerm.trim().length === 0) {
            return [];
        }

        const trimmedTerm = searchTerm.trim();

        const results = await this.repository.createQueryBuilder('entity')
            .leftJoinAndSelect('entity.entityType', 'entityType')
            .where('LOWER(entity.name) LIKE LOWER(:searchTerm)', {
                searchTerm: `%${trimmedTerm}%`
            })
            .orWhere('entity.aliases::text ILIKE :searchTerm', {
                searchTerm: `%${trimmedTerm}%`
            })
            .orderBy('entity.name', 'ASC')
            .limit(20)
            .getMany();

        return results;
    }

    async create(createEntityDto: CreateEntityDto): Promise<EntityEntity> {
        const entityType = await this.entityTypeService.findOne(createEntityDto.entityTypeId);
        if (!entityType) {
            throw new Error(`EntityType with id ${createEntityDto.entityTypeId} not found`);
        }

        const entity = this.repository.create({
            name: createEntityDto.name,
            aliases: createEntityDto.aliases,
            entityType,
        });

        return await this.repository.save(entity);
    }

    async update(id: number, updateEntityDto: UpdateEntityDto): Promise<EntityEntity | null> {
        const existingEntity = await this.repository.findOne({
            where: { id },
            relations: ['entityType']
        });

        if (!existingEntity) {
            return null;
        }

        if (updateEntityDto.entityTypeId && updateEntityDto.entityTypeId !== existingEntity.entityType.id) {
            const entityType = await this.entityTypeService.findOne(updateEntityDto.entityTypeId);
            if (!entityType) {
                throw new Error(`EntityType with id ${updateEntityDto.entityTypeId} not found`);
            }
            existingEntity.entityType = entityType;
        }

        if (updateEntityDto.name !== undefined) {
            existingEntity.name = updateEntityDto.name;
        }

        if (updateEntityDto.aliases !== undefined) {
            existingEntity.aliases = updateEntityDto.aliases;
        }

        return await this.repository.save(existingEntity);
    }

    async remove(id: number): Promise<void> {
        await this.repository.delete({ id });
    }

    async merge(sourceEntityId: number, targetEntityId: number): Promise<EntityEntity> {
        // Find both entities (don't load resources relation as it's the inverse side)
        const sourceEntity = await this.repository.findOne({
            where: { id: sourceEntityId },
            relations: ['entityType']
        });

        const targetEntity = await this.repository.findOne({
            where: { id: targetEntityId },
            relations: ['entityType']
        });

        if (!sourceEntity) {
            throw new Error(`Source entity with id ${sourceEntityId} not found`);
        }

        if (!targetEntity) {
            throw new Error(`Target entity with id ${targetEntityId} not found`);
        }

        // Merge aliases
        const sourceAliases = sourceEntity.aliases || [];
        const targetAliases = targetEntity.aliases || [];

        // Add source entity name as alias if not already present
        const allAliases = [...targetAliases];
        if (!allAliases.includes(sourceEntity.name)) {
            allAliases.push(sourceEntity.name);
        }

        // Add source aliases that aren't already present
        sourceAliases.forEach(alias => {
            if (!allAliases.includes(alias)) {
                allAliases.push(alias);
            }
        });

        // Update target entity with new aliases
        targetEntity.aliases = allAliases;
        await this.repository.save(targetEntity);

        // Move all resource relationships from source to target
        // Update relationships that don't already exist for the target entity
        await this.repository.query(
            `UPDATE resource_entities 
             SET entity_id = $1 
             WHERE entity_id = $2 
             AND NOT EXISTS (
                 SELECT 1 FROM resource_entities re2 
                 WHERE re2.resource_id = resource_entities.resource_id 
                 AND re2.entity_id = $1
             )`,
            [targetEntityId, sourceEntityId]
        );

        // Delete any remaining relationships for the source entity
        await this.repository.query(
            'DELETE FROM resource_entities WHERE entity_id = $1',
            [sourceEntityId]
        );

        // Delete the source entity
        await this.repository.delete({ id: sourceEntityId });

        return targetEntity;
    }

    async findOrCreate(name: string, entityTypeName: string, aliases?: string[]): Promise<EntityEntity> {
        // First try to find by name and type
        const entityType = await this.entityTypeService.findByName(entityTypeName);
        if (!entityType) {
            throw new Error(`EntityType '${entityTypeName}' not found`);
        }

        let entity = await this.findByNameAndType(name, entityType.id);

        if (!entity) {
            entity = await this.create({
                name,
                entityTypeId: entityType.id,
                aliases
            });
        }

        return entity;
    }
}
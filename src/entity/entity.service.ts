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
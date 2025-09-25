import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EntityTypeEntity } from './entity-type.entity';
import { CreateEntityTypeDto, UpdateEntityTypeDto } from './dto/entity-type.dto';

@Injectable()
export class EntityTypeService {
    constructor(
        @InjectRepository(EntityTypeEntity)
        private readonly repository: Repository<EntityTypeEntity>,
    ) { }

    async findAll(): Promise<EntityTypeEntity[]> {
        return await this.repository.find({
            order: { name: 'ASC' }
        });
    }

    async findOne(id: number): Promise<EntityTypeEntity | null> {
        return await this.repository.findOne({
            where: { id },
            relations: ['entities']
        });
    }

    async findByName(name: string): Promise<EntityTypeEntity | null> {
        return await this.repository.findOne({
            where: { name }
        });
    }

    async create(createEntityTypeDto: CreateEntityTypeDto): Promise<EntityTypeEntity> {
        const entityType = this.repository.create(createEntityTypeDto);
        return await this.repository.save(entityType);
    }

    async update(id: number, updateEntityTypeDto: UpdateEntityTypeDto): Promise<EntityTypeEntity | null> {
        const existingEntityType = await this.repository.preload({
            id,
            ...updateEntityTypeDto,
        });

        if (!existingEntityType) {
            return null;
        }

        return await this.repository.save(existingEntityType);
    }

    async remove(id: number): Promise<void> {
        await this.repository.delete({ id });
    }
}
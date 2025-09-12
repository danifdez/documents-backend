import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResourceTypeEntity } from './resource-type.entity';

@Injectable()
export class ResourceTypeService {
  constructor(
    @InjectRepository(ResourceTypeEntity)
    private readonly repository?: Repository<ResourceTypeEntity>,
  ) { }

  async findOne(id: number): Promise<ResourceTypeEntity | null> {
    return await this.repository.findOneBy({ id });
  }

  async create(resource: Partial<ResourceTypeEntity>): Promise<ResourceTypeEntity> {
    const created = this.repository.create(resource);
    return await this.repository.save(created);
  }

  async update(
    id: number,
    resource: Partial<ResourceTypeEntity>,
  ): Promise<ResourceTypeEntity | null> {
    const existing = await this.repository.preload({ id, ...resource });
    if (!existing) return null;
    return await this.repository.save(existing);
  }

  async remove(id: number): Promise<void> {
    this.repository.delete({ id });
  }

  async findAll(): Promise<ResourceTypeEntity[]> {
    return await this.repository.find({ order: { createdAt: 'DESC' } });
  }
}

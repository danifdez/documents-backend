import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResourceDateEntity } from './resource-date.entity';

@Injectable()
export class ResourceDateService {
  constructor(
    @InjectRepository(ResourceDateEntity)
    private readonly repo: Repository<ResourceDateEntity>,
  ) {}

  async findByResourceId(resourceId: number): Promise<ResourceDateEntity[]> {
    return this.repo.find({
      where: { resourceId },
      order: { date: 'ASC', charOffset: 'ASC' },
    });
  }

  async remove(id: number): Promise<boolean> {
    const result = await this.repo.delete({ id });
    return (result.affected ?? 0) > 0;
  }
}

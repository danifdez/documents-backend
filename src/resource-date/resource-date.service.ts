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

  findByResourceId(resourceId: number): Promise<ResourceDateEntity[]> {
    return this.repo.find({
      where: { resourceId },
      order: { date: 'ASC', charOffset: 'ASC' },
    });
  }

  async remove(resourceId: number, id: number): Promise<boolean> {
    const result = await this.repo.delete({ id, resourceId });
    return (result.affected ?? 0) > 0;
  }
}

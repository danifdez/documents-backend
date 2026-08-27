import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResourceDateEntity } from './resource-date.entity';
import { ResourceDatePayload } from './dto/resource-date.dto';

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

  async replaceByResourceId(
    resourceId: number,
    dates: ResourceDatePayload[],
  ): Promise<ResourceDateEntity[]> {
    await this.repo.delete({ resourceId });
    if (!dates.length) return [];

    const rows = dates.map((d) =>
      this.repo.create({
        resourceId,
        date: d.date ?? null,
        endDate: d.endDate ?? null,
        rawExpression: d.rawExpression,
        precision: d.precision ?? null,
        charOffset: d.charOffset ?? null,
        contextSnippet: d.contextSnippet ?? null,
        unresolvedReason: d.unresolvedReason ?? null,
      }),
    );
    return this.repo.save(rows);
  }

  async remove(id: number): Promise<boolean> {
    const result = await this.repo.delete({ id });
    return (result.affected ?? 0) > 0;
  }

  async clearByResourceId(resourceId: number): Promise<void> {
    await this.repo.delete({ resourceId });
  }
}

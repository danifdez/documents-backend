import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResourceEntity } from './resource.entity';

@Injectable()
export class ResourceService {
  constructor(
    @InjectRepository(ResourceEntity)
    private readonly repo: Repository<ResourceEntity>,
  ) {}

  async findOne(id: number): Promise<ResourceEntity | null> {
    return await this.repo.findOneBy({ id });
  }

  async create(resource: Partial<ResourceEntity>): Promise<ResourceEntity> {
    const created = this.repo.create(resource);
    return await this.repo.save(created);
  }

  async findByProject(projectId: number): Promise<ResourceEntity[]> {
    return await this.repo.find({
      where: { project: { id: projectId } },
      order: { createdAt: 'DESC' },
      take: 10,
    });
  }

  async search(query: string): Promise<ResourceEntity[]> {
    if (!query || !query.trim()) return [];
    return await this.repo
      .createQueryBuilder('r')
      .where('r.name ILIKE :q', { q: `%${query}%` })
      .orderBy('r.createdAt', 'DESC')
      .limit(10)
      .getMany();
  }

  async findByHash(hash: string): Promise<ResourceEntity | null> {
    return await this.repo.findOne({ where: { hash } });
  }

  async update(
    id: number,
    resource: Partial<any>,
  ): Promise<ResourceEntity | null> {
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
    return await this.repo
      .createQueryBuilder('r')
      .where('r.content ILIKE :q OR r.name ILIKE :q', { q: `%${searchTerm}%` })
      .orderBy('similarity(r.content, :s)', 'DESC')
      .setParameter('s', searchTerm)
      .limit(50)
      .getMany();
  }
}

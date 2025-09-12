import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectEntity } from './project.entity';

@Injectable()
export class ProjectService {
  constructor(
    @InjectRepository(ProjectEntity)
    private readonly repository: Repository<ProjectEntity>,
  ) { }

  async findOne(id: number): Promise<ProjectEntity | null> {
    return await this.repository.findOneBy({ id });
  }

  async create(project: Partial<ProjectEntity>): Promise<ProjectEntity> {
    const created = this.repository.create(project);
    return this.repository.save(created);
  }

  async findAll(): Promise<ProjectEntity[]> {
    return await this.repository.find({ order: { createdAt: 'DESC' } });
  }

  async search(query: string): Promise<ProjectEntity[]> {
    if (!query || !query.trim()) return this.findAll();
    const like = `%${query}%`;
    return await this.repository
      .createQueryBuilder('p')
      .where('p.name ILIKE :q OR p.description ILIKE :q', { q: like })
      .orderBy('similarity(p.name, :s)', 'DESC')
      .setParameter('s', query)
      .getMany();
  }

  async update(id: number, project: Partial<ProjectEntity>): Promise<ProjectEntity | null> {
    const existing = await this.repository.findOneBy({ id });
    if (!existing) return null;
    Object.assign(existing, project);
    const saved = await this.repository.save(existing);
    return saved;
  }

  async remove(id: number): Promise<void> {
    const p = await this.repository.findOneBy({ id });
    if (p) await this.repository.remove(p);
  }
}

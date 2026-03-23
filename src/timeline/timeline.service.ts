import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TimelineEntity } from './timeline.entity';

@Injectable()
export class TimelineService {
  constructor(
    @InjectRepository(TimelineEntity)
    private readonly repository: Repository<TimelineEntity>,
  ) { }

  async findOne(id: number): Promise<TimelineEntity | null> {
    return await this.repository.findOne({
      where: { id },
      relations: ['project'],
    });
  }

  async findByProject(projectId: number): Promise<TimelineEntity[]> {
    return await this.repository
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.project', 'project')
      .where('t.projectId = :projectId', { projectId })
      .orderBy('t.updated_at', 'DESC')
      .getMany();
  }

  async create(data: Partial<TimelineEntity>): Promise<TimelineEntity> {
    const created = this.repository.create(data);
    return await this.repository.save(created);
  }

  async update(id: number, data: Partial<TimelineEntity>): Promise<TimelineEntity | null> {
    const timeline = await this.repository.preload({ id, ...data });
    if (!timeline) return null;
    return await this.repository.save(timeline);
  }

  async remove(id: number): Promise<{ deleted: boolean }> {
    const timeline = await this.repository.findOneBy({ id });
    if (!timeline) return { deleted: false };
    await this.repository.remove(timeline);
    return { deleted: true };
  }
}

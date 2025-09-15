import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ThreadEntity } from './thread.entity';

@Injectable()
export class ThreadService {
  constructor(
    @InjectRepository(ThreadEntity)
    private readonly repository: Repository<ThreadEntity>,
  ) {}

  async findOne(id: number): Promise<ThreadEntity | null> {
    return await this.repository.findOneBy({ id });
  }

  async create(thread: Partial<ThreadEntity>): Promise<ThreadEntity> {
    const created = this.repository.create(thread);
    return await this.repository.save(created);
  }

  async findByProject(projectId: number): Promise<ThreadEntity[]> {
    return await this.repository.find({
      where: { project: { id: projectId } },
      order: { createdAt: 'DESC' },
    });
  }
}

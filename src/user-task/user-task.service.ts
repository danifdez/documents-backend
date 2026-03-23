import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { UserTaskEntity } from './user-task.entity';

@Injectable()
export class UserTaskService {
  constructor(
    @InjectRepository(UserTaskEntity)
    private readonly repository: Repository<UserTaskEntity>,
  ) { }

  async findAll(): Promise<UserTaskEntity[]> {
    return await this.repository.find({
      relations: ['project'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: number): Promise<UserTaskEntity | null> {
    return await this.repository.findOne({
      where: { id },
      relations: ['project'],
    });
  }

  async findByProject(projectId: number): Promise<UserTaskEntity[]> {
    return await this.repository
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.project', 'project')
      .where('t.projectId = :projectId', { projectId })
      .orderBy('t.created_at', 'DESC')
      .getMany();
  }

  async findGeneral(): Promise<UserTaskEntity[]> {
    return await this.repository.find({
      where: { project: IsNull() },
      order: { createdAt: 'DESC' },
    });
  }

  async create(task: Partial<UserTaskEntity>): Promise<UserTaskEntity> {
    const created = this.repository.create(task);
    return await this.repository.save(created);
  }

  async update(id: number, data: Partial<UserTaskEntity>): Promise<UserTaskEntity | null> {
    const task = await this.repository.preload({ id, ...data });
    if (!task) return null;
    return await this.repository.save(task);
  }

  async remove(id: number): Promise<{ deleted: boolean }> {
    const task = await this.repository.findOneBy({ id });
    if (!task) return { deleted: false };
    await this.repository.remove(task);
    return { deleted: true };
  }
}

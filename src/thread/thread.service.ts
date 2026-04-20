import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ThreadEntity } from './thread.entity';
import { CreateThreadDto } from './dto/thread.dto';

@Injectable()
export class ThreadService {
  constructor(
    @InjectRepository(ThreadEntity)
    private readonly repository: Repository<ThreadEntity>,
  ) { }

  async findOne(id: number): Promise<ThreadEntity | null> {
    return await this.repository.findOne({
      where: { id },
      relations: ['parent', 'children'],
    });
  }

  async create(dto: CreateThreadDto): Promise<ThreadEntity> {
    const data: Partial<ThreadEntity> = { name: dto.name };
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.projectId) data.project = { id: dto.projectId } as any;
    if (dto.parentId) data.parent = { id: dto.parentId } as any;
    const created = this.repository.create(data);
    return await this.repository.save(created);
  }

  async findByProject(projectId: number, includeArchived = false): Promise<ThreadEntity[]> {
    const where: any = { project: { id: projectId } };
    if (!includeArchived) where.status = 'active';
    return await this.repository.find({
      where,
      relations: ['parent'],
      order: { createdAt: 'DESC' },
    });
  }

  async findByParent(parentId: number, includeArchived = false): Promise<ThreadEntity[]> {
    const where: any = { parent: { id: parentId } };
    if (!includeArchived) where.status = 'active';
    return await this.repository.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }
}

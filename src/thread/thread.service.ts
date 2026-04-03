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

  async findByProject(projectId: number): Promise<ThreadEntity[]> {
    return await this.repository.find({
      where: { project: { id: projectId } },
      relations: ['parent'],
      order: { createdAt: 'DESC' },
    });
  }

  async findByParent(parentId: number): Promise<ThreadEntity[]> {
    return await this.repository.find({
      where: { parent: { id: parentId } },
      order: { createdAt: 'DESC' },
    });
  }
}

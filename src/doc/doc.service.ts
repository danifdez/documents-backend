import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DocEntity } from './doc.entity';
import { CreateDocDto, UpdateDocDto } from './dto/doc.dto';
import { globalSimilaritySearch } from '../common/global-search';

@Injectable()
export class DocService {
  constructor(
    @InjectRepository(DocEntity)
    private readonly repository: Repository<DocEntity>,
  ) { }

  async findOne(id: number): Promise<DocEntity | null> {
    return await this.repository.findOneBy({ id });
  }

  async findOneWithProject(id: number): Promise<DocEntity | null> {
    return await this.repository.findOne({
      where: { id },
      relations: ['project'],
    });
  }

  async create(dto: CreateDocDto): Promise<DocEntity> {
    const data: Partial<DocEntity> = { name: dto.name };
    if (dto.content !== undefined) data.content = dto.content;
    if (dto.citationFormat !== undefined) data.citationFormat = dto.citationFormat;
    if (dto.projectId) data.project = { id: dto.projectId } as any;
    if (dto.threadId) data.thread = { id: dto.threadId } as any;
    if (dto.resourceId) data.resource = { id: dto.resourceId } as any;
    const created = this.repository.create(data);
    return await this.repository.save(created);
  }

  async findByThread(threadId: number): Promise<DocEntity[]> {
    // exclude docs that are workspaces for resources (resource IS NOT NULL)
    return await this.repository
      .createQueryBuilder('d')
      .where('d.threadId = :threadId', { threadId })
      .andWhere('d."resourceId" IS NULL')
      .orderBy('d.created_at', 'DESC')
      .getMany();
  }

  async findByProject(projectId: number): Promise<DocEntity[]> {
    // exclude docs that are workspaces for resources
    return await this.repository
      .createQueryBuilder('d')
      .where('d.projectId = :projectId', { projectId })
      .andWhere('d."resourceId" IS NULL')
      .orderBy('d.created_at', 'DESC')
      .getMany();
  }

  async findByResource(resourceId: number): Promise<DocEntity | null> {
    return this.repository.findOne({
      where: { resource: { id: resourceId } },
    });
  }

  async update(id: number, dto: UpdateDocDto): Promise<DocEntity | null> {
    const data: Partial<DocEntity> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.content !== undefined) data.content = dto.content;
    if (dto.citationFormat !== undefined) data.citationFormat = dto.citationFormat;
    if (dto.projectId !== undefined) data.project = dto.projectId ? { id: dto.projectId } as any : null;
    if (dto.threadId !== undefined) data.thread = dto.threadId ? { id: dto.threadId } as any : null;
    if (dto.resourceId !== undefined) data.resource = dto.resourceId ? { id: dto.resourceId } as any : null;
    const doc = await this.repository.preload({ id, ...data });
    if (!doc) return null;
    return await this.repository.save(doc);
  }

  async remove(id: number): Promise<{ deleted: boolean }> {
    const doc = await this.repository.findOneBy({ id });
    if (!doc) {
      return { deleted: false };
    }

    await this.repository.remove(doc);
    return { deleted: true };
  }

  async globalSearch(searchTerm: string, projectId?: number): Promise<any[]> {
    return await globalSimilaritySearch(
      this.repository,
      searchTerm,
      projectId,
      {
        alias: 'd',
        select: ['d.id', 'd.name', 'd.content'],
        scoreColumn: 'd.name',
        searchColumns: ['d.name', 'd.content'],
        projectIdColumn: 'd.projectId',
      },
    );
  }
}

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CanvasEntity } from './canvas.entity';
import { CreateCanvasDto, UpdateCanvasDto } from './dto/canvas.dto';

@Injectable()
export class CanvasService {
  constructor(
    @InjectRepository(CanvasEntity)
    private readonly repository: Repository<CanvasEntity>,
  ) { }

  async findOne(id: number): Promise<CanvasEntity | null> {
    return await this.repository.findOneBy({ id });
  }

  async create(dto: CreateCanvasDto): Promise<CanvasEntity> {
    const data: Partial<CanvasEntity> = { name: dto.name };
    if (dto.canvasData !== undefined) data.canvasData = dto.canvasData;
    if (dto.content !== undefined) data.content = dto.content;
    if (dto.projectId) data.project = { id: dto.projectId } as any;
    if (dto.threadId) data.thread = { id: dto.threadId } as any;
    if (data.canvasData) {
      data.content = this.extractTextFromCanvas(data.canvasData);
    }
    const created = this.repository.create(data);
    return await this.repository.save(created);
  }

  async findByThread(threadId: number): Promise<CanvasEntity[]> {
    return await this.repository
      .createQueryBuilder('c')
      .where('c.threadId = :threadId', { threadId })
      .orderBy('c.created_at', 'DESC')
      .getMany();
  }

  async findByProject(projectId: number): Promise<CanvasEntity[]> {
    return await this.repository
      .createQueryBuilder('c')
      .where('c.projectId = :projectId', { projectId })
      .orderBy('c.created_at', 'DESC')
      .getMany();
  }

  async update(id: number, dto: UpdateCanvasDto): Promise<CanvasEntity | null> {
    const data: Partial<CanvasEntity> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.canvasData !== undefined) data.canvasData = dto.canvasData;
    if (dto.content !== undefined) data.content = dto.content;
    if (dto.projectId !== undefined) data.project = dto.projectId ? { id: dto.projectId } as any : null;
    if (dto.threadId !== undefined) data.thread = dto.threadId ? { id: dto.threadId } as any : null;
    if (data.canvasData) {
      data.content = this.extractTextFromCanvas(data.canvasData);
    }
    const canvas = await this.repository.preload({ id, ...data });
    if (!canvas) return null;
    return await this.repository.save(canvas);
  }

  async remove(id: number): Promise<{ deleted: boolean }> {
    const canvas = await this.repository.findOneBy({ id });
    if (!canvas) {
      return { deleted: false };
    }

    await this.repository.remove(canvas);
    return { deleted: true };
  }

  async globalSearch(searchTerm: string, projectId?: number): Promise<any[]> {
    if (!searchTerm || searchTerm.trim() === '') return [];
    const like = `%${searchTerm}%`;
    const qb = this.repository
      .createQueryBuilder('c')
      .select(['c.id', 'c.name', 'c.content'])
      .addSelect('similarity(unaccent(c.name), unaccent(:s))', 'score')
      .where('unaccent(c.name) ILIKE unaccent(:q) OR unaccent(c.content) ILIKE unaccent(:q)', { q: like })
      .setParameter('s', searchTerm);
    if (projectId) {
      qb.andWhere('c.projectId = :projectId', { projectId });
    }
    return await qb.orderBy('score', 'DESC').limit(50).getRawMany();
  }

  private extractTextFromCanvas(canvasData: object): string {
    const data = canvasData as { nodes?: Array<{ data?: Record<string, any> }> };
    if (!data.nodes || !Array.isArray(data.nodes)) return '';

    return data.nodes
      .map((node) => {
        if (!node.data) return '';
        const texts: string[] = [];
        if (node.data.text) texts.push(node.data.text);
        if (node.data.label) texts.push(node.data.label);
        if (node.data.content) texts.push(node.data.content);
        if (node.data.title) texts.push(node.data.title);
        return texts.join(' ');
      })
      .filter(Boolean)
      .join(' ');
  }
}

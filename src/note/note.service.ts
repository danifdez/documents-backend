import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { NoteEntity } from './note.entity';
import { CreateNoteDto, UpdateNoteDto } from './dto/note.dto';

@Injectable()
export class NoteService {
  constructor(
    @InjectRepository(NoteEntity)
    private readonly repository: Repository<NoteEntity>,
  ) { }

  async findAll(): Promise<NoteEntity[]> {
    return await this.repository.find({
      relations: ['project', 'thread'],
      order: { updatedAt: 'DESC' },
    });
  }

  async findOne(id: number): Promise<NoteEntity | null> {
    return await this.repository.findOne({
      where: { id },
      relations: ['project', 'thread'],
    });
  }

  async findByProject(projectId: number): Promise<NoteEntity[]> {
    return await this.repository
      .createQueryBuilder('n')
      .leftJoinAndSelect('n.project', 'project')
      .where('n.projectId = :projectId', { projectId })
      .orderBy('n.updated_at', 'DESC')
      .getMany();
  }

  async findByThread(threadId: number): Promise<NoteEntity[]> {
    return await this.repository
      .createQueryBuilder('n')
      .leftJoinAndSelect('n.project', 'project')
      .leftJoinAndSelect('n.thread', 'thread')
      .where('n.threadId = :threadId', { threadId })
      .orderBy('n.updated_at', 'DESC')
      .getMany();
  }

  async findGeneral(): Promise<NoteEntity[]> {
    return await this.repository.find({
      where: { project: IsNull() },
      order: { updatedAt: 'DESC' },
    });
  }

  async create(dto: CreateNoteDto): Promise<NoteEntity> {
    const data: Partial<NoteEntity> = { title: dto.title };
    if (dto.content !== undefined) data.content = dto.content;
    if (dto.projectId) data.project = { id: dto.projectId } as any;
    if (dto.threadId) data.thread = { id: dto.threadId } as any;
    const created = this.repository.create(data);
    return await this.repository.save(created);
  }

  async update(id: number, dto: UpdateNoteDto): Promise<NoteEntity | null> {
    const data: Partial<NoteEntity> = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.content !== undefined) data.content = dto.content;
    if (dto.projectId !== undefined) data.project = dto.projectId ? { id: dto.projectId } as any : null;
    if (dto.threadId !== undefined) data.thread = dto.threadId ? { id: dto.threadId } as any : null;
    const note = await this.repository.preload({ id, ...data });
    if (!note) return null;
    return await this.repository.save(note);
  }

  async globalSearch(searchTerm: string, projectId?: number): Promise<any[]> {
    if (!searchTerm || searchTerm.trim() === '') return [];
    const like = `%${searchTerm}%`;
    const qb = this.repository
      .createQueryBuilder('n')
      .select(['n.id', 'n.title', 'n.content'])
      .addSelect('similarity(unaccent(n.title), unaccent(:s))', 'score')
      .where('unaccent(n.title) ILIKE unaccent(:q) OR unaccent(n.content) ILIKE unaccent(:q)', { q: like })
      .setParameter('s', searchTerm);
    if (projectId) {
      qb.andWhere('n.projectId = :projectId', { projectId });
    } else {
      qb.andWhere('n.projectId IS NULL');
    }
    return await qb.orderBy('score', 'DESC').limit(50).getRawMany();
  }

  async remove(id: number): Promise<{ deleted: boolean }> {
    const note = await this.repository.findOneBy({ id });
    if (!note) return { deleted: false };
    await this.repository.remove(note);
    return { deleted: true };
  }
}

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MarkEntity } from './mark.entity';

@Injectable()
export class MarkService {
  constructor(
    @InjectRepository(MarkEntity)
    private readonly repository: Repository<MarkEntity>,
  ) {}

  async findOne(id: number): Promise<MarkEntity | null> {
    return await this.repository.findOneBy({ id });
  }

  async create(mark: Partial<MarkEntity>): Promise<MarkEntity> {
    const created = this.repository.create(mark);
    return await this.repository.save(created);
  }

  async findByDoc(docId: number): Promise<MarkEntity[]> {
    return await this.repository.find({
      where: { doc: { id: docId } },
      order: { createdAt: 'DESC' },
    });
  }

  async search(query: string): Promise<MarkEntity[]> {
    if (!query || !query.trim()) return [];
    const like = `%${query}%`;
    return await this.repository
      .createQueryBuilder('m')
      .where('m.content ILIKE :q', { q: like })
      .orderBy('m.createdAt', 'DESC')
      .limit(10)
      .getMany();
  }

  async update(
    id: number,
    markData: Partial<MarkEntity>,
  ): Promise<MarkEntity | null> {
    const existing = await this.repository.findOneBy({ id });
    if (!existing) return null;
    Object.assign(existing as any, markData);
    const saved = await this.repository.save(existing as any);
    return {
      id: saved.id,
      doc: saved.doc,
      content: saved.content,
      createdAt: saved.createdAt ?? (saved as any).created_at,
      updatedAt: saved.updatedAt ?? (saved as any).updated_at,
    };
  }

  async delete(id: number): Promise<void> {
    await this.repository.delete({ id });
  }
}

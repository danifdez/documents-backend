import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DocEntity } from './doc.entity';

@Injectable()
export class DocService {
  constructor(
    @InjectRepository(DocEntity)
    private readonly repository: Repository<DocEntity>,
  ) { }

  async findOne(id: number): Promise<DocEntity | null> {
    return await this.repository.findOneBy({ id });
  }

  async create(doc: Partial<DocEntity>): Promise<DocEntity> {
    const created = this.repository.create(doc);
    return await this.repository.save(created);
  }

  async findByThread(threadId: number): Promise<DocEntity[]> {
    return await this.repository.find({
      where: { thread: { id: threadId } },
      order: { createdAt: 'DESC' },
    });
  }

  async findByProject(projectId: number): Promise<DocEntity[]> {
    return this.repository.find({
      where: { project: { id: projectId } },
      order: { createdAt: 'DESC' },
    });
  }

  async update(
    id: number,
    docData: Partial<DocEntity>,
  ): Promise<DocEntity | null> {
    const doc = await this.repository.preload({ id, ...docData });
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

  async globalSearch(searchTerm: string): Promise<DocEntity[]> {
    if (!searchTerm || searchTerm.trim() === '') return [];
    const like = `%${searchTerm}%`;
    return await this.repository
      .createQueryBuilder('d')
      .select(['d.id', 'd.name', 'd.content'])
      .where('d.name ILIKE :q OR d.content ILIKE :q', { q: like })
      .orderBy('similarity(d.name, :s)', 'DESC')
      .setParameter('s', searchTerm)
      .limit(50)
      .getRawMany();
  }
}

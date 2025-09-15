import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommentEntity } from './comment.entity';

@Injectable()
export class CommentService {
  constructor(
    @InjectRepository(CommentEntity)
    private readonly repository: Repository<CommentEntity>,
  ) {}

  async findOne(id: number): Promise<CommentEntity | null> {
    return this.repository.findOneBy({ id });
  }

  async create(comment: Partial<CommentEntity>): Promise<CommentEntity> {
    const created = this.repository.create(comment);
    return await this.repository.save(created);
  }

  async findByDoc(docId: number): Promise<CommentEntity[]> {
    return this.repository.find({
      where: { doc: { id: docId } },
      order: { createdAt: 'DESC' },
    });
  }

  async update(
    id: number,
    commentData: Partial<CommentEntity>,
  ): Promise<CommentEntity | null> {
    const comment = await this.repository.preload({ id, ...commentData });
    if (!comment) return null;
    return this.repository.save(comment);
  }

  async delete(id: number): Promise<void> {
    await this.repository.delete({ id });
  }
}

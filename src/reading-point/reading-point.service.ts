import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ReadingPointEntity } from './reading-point.entity';

@Injectable()
export class ReadingPointService {
  constructor(
    @InjectRepository(ReadingPointEntity)
    private readonly repository: Repository<ReadingPointEntity>,
  ) {}

  async findOne(id: number): Promise<ReadingPointEntity | null> {
    return await this.repository.findOne({
      where: { id },
      relations: ['doc', 'resource'],
    });
  }

  async create(
    point: Partial<ReadingPointEntity>,
  ): Promise<ReadingPointEntity> {
    const data = { kind: 'section' as const, ...point };

    if (data.kind === 'reading') {
      return await this.repository.manager.transaction(async (manager) => {
        const repo = manager.getRepository(ReadingPointEntity);
        await repo.delete(this.readingScope(data));
        return await repo.save(repo.create(data));
      });
    }

    return await this.repository.save(this.repository.create(data));
  }

  // Solo puede haber una marca de lectura por documento o recurso. Guardar otra
  // sustituye la anterior, como en el navegador.
  private readingScope(data: Partial<ReadingPointEntity>): Record<string, any> {
    if (data.doc) return { kind: 'reading', doc: data.doc };
    if (data.resource) return { kind: 'reading', resource: data.resource };
    return { kind: 'reading' };
  }

  async findByDoc(docId: number): Promise<ReadingPointEntity[]> {
    return await this.repository.find({
      where: { doc: { id: docId } },
      order: { createdAt: 'DESC' },
    });
  }

  async findByResource(resourceId: number): Promise<ReadingPointEntity[]> {
    return await this.repository.find({
      where: { resource: { id: resourceId } },
      order: { createdAt: 'DESC' },
    });
  }

  async update(
    id: number,
    pointData: Partial<ReadingPointEntity>,
  ): Promise<ReadingPointEntity | null> {
    const existing = await this.repository.findOneBy({ id });
    if (!existing) return null;

    Object.assign(existing, pointData);
    const saved = await this.repository.save(existing);
    return saved;
  }

  async delete(id: number): Promise<void> {
    await this.repository.delete({ id });
  }
}

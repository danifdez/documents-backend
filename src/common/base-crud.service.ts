import { Repository, DeepPartial, FindOneOptions, FindManyOptions, ObjectLiteral } from 'typeorm';

export abstract class BaseCrudService<T extends ObjectLiteral> {
  constructor(protected readonly repository: Repository<T>) {}

  async findOne(id: number, options?: FindOneOptions<T>): Promise<T | null> {
    return await this.repository.findOne({
      where: { id } as any,
      ...options,
    });
  }

  async findAll(options?: FindManyOptions<T>): Promise<T[]> {
    return await this.repository.find(options);
  }

  async create(data: DeepPartial<T>): Promise<T> {
    const entity = this.repository.create(data);
    return await this.repository.save(entity);
  }

  async update(id: number, data: DeepPartial<T>): Promise<T | null> {
    const existing = await this.repository.preload({ id, ...data } as any);
    if (!existing) return null;
    return await this.repository.save(existing);
  }

  async remove(id: number): Promise<T | null> {
    const entity = await this.repository.findOneBy({ id } as any);
    if (!entity) return null;
    await this.repository.remove(entity);
    return entity;
  }
}

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CalendarEventEntity } from './calendar-event.entity';

@Injectable()
export class CalendarEventService {
  constructor(
    @InjectRepository(CalendarEventEntity)
    private readonly repository: Repository<CalendarEventEntity>,
  ) { }

  async findAll(): Promise<CalendarEventEntity[]> {
    return await this.repository.find({
      relations: ['project'],
      order: { startDate: 'ASC' },
    });
  }

  async findOne(id: number): Promise<CalendarEventEntity | null> {
    return await this.repository.findOne({
      where: { id },
      relations: ['project'],
    });
  }

  async findByProject(projectId: number): Promise<CalendarEventEntity[]> {
    return await this.repository
      .createQueryBuilder('e')
      .leftJoinAndSelect('e.project', 'project')
      .where('e.projectId = :projectId', { projectId })
      .orderBy('e.start_date', 'ASC')
      .getMany();
  }

  async findByDateRange(start: string, end: string, projectId?: number): Promise<CalendarEventEntity[]> {
    const qb = this.repository
      .createQueryBuilder('e')
      .leftJoinAndSelect('e.project', 'project')
      .where('e.start_date <= :end AND (e.end_date >= :start OR e.end_date IS NULL)', { start, end });

    if (projectId) {
      qb.andWhere('e.projectId = :projectId', { projectId });
    }

    return await qb.orderBy('e.start_date', 'ASC').getMany();
  }

  async create(event: Partial<CalendarEventEntity>): Promise<CalendarEventEntity> {
    const created = this.repository.create(event);
    return await this.repository.save(created);
  }

  async update(id: number, data: Partial<CalendarEventEntity>): Promise<CalendarEventEntity | null> {
    const event = await this.repository.preload({ id, ...data });
    if (!event) return null;
    return await this.repository.save(event);
  }

  async globalSearch(searchTerm: string, projectId?: number): Promise<any[]> {
    if (!searchTerm || searchTerm.trim() === '') return [];
    const like = `%${searchTerm}%`;
    const qb = this.repository
      .createQueryBuilder('e')
      .select(['e.id', 'e.title', 'e.description'])
      .addSelect('similarity(unaccent(e.title), unaccent(:s))', 'score')
      .where('unaccent(e.title) ILIKE unaccent(:q) OR unaccent(e.description) ILIKE unaccent(:q)', { q: like })
      .setParameter('s', searchTerm);
    if (projectId) {
      qb.andWhere('e.projectId = :projectId', { projectId });
    }
    return await qb.orderBy('score', 'DESC').limit(50).getRawMany();
  }

  async remove(id: number): Promise<{ deleted: boolean }> {
    const event = await this.repository.findOneBy({ id });
    if (!event) return { deleted: false };
    await this.repository.remove(event);
    return { deleted: true };
  }
}

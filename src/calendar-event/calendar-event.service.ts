import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CalendarEventEntity } from './calendar-event.entity';
import { CreateCalendarEventDto, UpdateCalendarEventDto } from './dto/calendar-event.dto';
import { CalendarEventExpansionService, OccurrenceDescriptor } from './calendar-event-expansion.service';

export interface CalendarEventOccurrence {
  id: number;
  title: string;
  description: string | null;
  startDate: Date;
  endDate: Date | null;
  occurrenceStart: Date;
  occurrenceEnd: Date | null;
  color: string;
  allDay: boolean;
  recurrenceRule: string | null;
  alarm: CalendarEventEntity['alarm'];
  project: CalendarEventEntity['project'];
}

@Injectable()
export class CalendarEventService {
  constructor(
    @InjectRepository(CalendarEventEntity)
    private readonly repository: Repository<CalendarEventEntity>,
    private readonly expansion: CalendarEventExpansionService,
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

  async findByDateRange(
    start: string,
    end: string,
    projectId?: number,
    tz?: string,
  ): Promise<CalendarEventOccurrence[]> {
    const qb = this.repository
      .createQueryBuilder('e')
      .leftJoinAndSelect('e.project', 'project')
      .where(
        '(e.recurrence_rule IS NULL AND e.start_date <= :end AND (e.end_date >= :start OR e.end_date IS NULL))' +
          ' OR (e.recurrence_rule IS NOT NULL AND e.start_date <= :end)',
        { start, end },
      );

    if (projectId) {
      qb.andWhere('e.projectId = :projectId', { projectId });
    }

    const events = await qb.orderBy('e.start_date', 'ASC').getMany();
    const rangeStart = new Date(start);
    const rangeEnd = new Date(end);
    const out: CalendarEventOccurrence[] = [];
    for (const event of events) {
      const occurrences = this.expansion.expand(event, rangeStart, rangeEnd, tz);
      for (const o of occurrences) {
        out.push(this.toOccurrence(event, o));
      }
    }
    out.sort((a, b) => a.occurrenceStart.getTime() - b.occurrenceStart.getTime());
    return out;
  }

  private toOccurrence(event: CalendarEventEntity, o: OccurrenceDescriptor): CalendarEventOccurrence {
    return {
      id: event.id,
      title: event.title,
      description: event.description,
      startDate: event.startDate,
      endDate: event.endDate,
      occurrenceStart: o.occurrenceStart,
      occurrenceEnd: o.occurrenceEnd,
      color: event.color,
      allDay: event.allDay,
      recurrenceRule: event.recurrenceRule,
      alarm: event.alarm,
      project: event.project,
    };
  }

  async create(dto: CreateCalendarEventDto): Promise<CalendarEventEntity> {
    const data: Partial<CalendarEventEntity> = { title: dto.title, startDate: dto.startDate };
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.endDate !== undefined) data.endDate = dto.endDate;
    if (dto.color !== undefined) data.color = dto.color;
    if (dto.allDay !== undefined) data.allDay = dto.allDay;
    if (dto.recurrenceRule !== undefined) data.recurrenceRule = dto.recurrenceRule;
    if (dto.alarm !== undefined) data.alarm = dto.alarm;
    if (dto.projectId) data.project = { id: dto.projectId } as any;
    const created = this.repository.create(data);
    return await this.repository.save(created);
  }

  async update(id: number, dto: UpdateCalendarEventDto): Promise<CalendarEventEntity | null> {
    const data: Partial<CalendarEventEntity> = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.startDate !== undefined) data.startDate = dto.startDate;
    if (dto.endDate !== undefined) data.endDate = dto.endDate;
    if (dto.color !== undefined) data.color = dto.color;
    if (dto.allDay !== undefined) data.allDay = dto.allDay;
    if (dto.recurrenceRule !== undefined) data.recurrenceRule = dto.recurrenceRule;
    if (dto.alarm !== undefined) data.alarm = dto.alarm;
    if (dto.projectId !== undefined) data.project = dto.projectId ? { id: dto.projectId } as any : null;
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

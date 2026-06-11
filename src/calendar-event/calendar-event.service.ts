import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CalendarEventEntity } from './calendar-event.entity';
import { EventOccurrenceCompletionEntity } from './event-occurrence-completion.entity';
import { CreateCalendarEventDto, UpdateCalendarEventDto } from './dto/calendar-event.dto';
import { CalendarEventExpansionService, OccurrenceDescriptor } from './calendar-event-expansion.service';
import { globalSimilaritySearch } from '../common/global-search';

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
  trackCompletion: boolean;
  completed: boolean;
  project: CalendarEventEntity['project'];
}

@Injectable()
export class CalendarEventService {
  constructor(
    @InjectRepository(CalendarEventEntity)
    private readonly repository: Repository<CalendarEventEntity>,
    @InjectRepository(EventOccurrenceCompletionEntity)
    private readonly completionRepo: Repository<EventOccurrenceCompletionEntity>,
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

    const trackableEventIds = events.filter((e) => e.trackCompletion).map((e) => e.id);
    const completionsByEvent = await this.loadCompletionsInRange(
      trackableEventIds,
      rangeStart,
      rangeEnd,
    );

    const out: CalendarEventOccurrence[] = [];
    for (const event of events) {
      const set = completionsByEvent.get(event.id);
      const occurrences = this.expansion.expand(event, rangeStart, rangeEnd, tz, set);
      for (const o of occurrences) {
        out.push(this.toOccurrence(event, o));
      }
    }
    out.sort((a, b) => a.occurrenceStart.getTime() - b.occurrenceStart.getTime());
    return out;
  }

  private async loadCompletionsInRange(
    eventIds: number[],
    rangeStart: Date,
    rangeEnd: Date,
  ): Promise<Map<number, Set<string>>> {
    const map = new Map<number, Set<string>>();
    if (eventIds.length === 0) return map;
    const rows = await this.completionRepo
      .createQueryBuilder('c')
      .select('c.event_id', 'eventId')
      .addSelect('c.occurrence_date', 'occurrenceDate')
      .where('c.event_id IN (:...eventIds)', { eventIds })
      .andWhere('c.occurrence_date BETWEEN :start AND :end', {
        start: rangeStart,
        end: rangeEnd,
      })
      .getRawMany<{ eventId: number; occurrenceDate: Date }>();
    for (const r of rows) {
      const key = new Date(r.occurrenceDate).toISOString();
      let set = map.get(r.eventId);
      if (!set) {
        set = new Set();
        map.set(r.eventId, set);
      }
      set.add(key);
    }
    return map;
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
      trackCompletion: event.trackCompletion,
      completed: o.completed,
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
    if (dto.trackCompletion !== undefined) data.trackCompletion = dto.trackCompletion;
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
    if (dto.trackCompletion !== undefined) data.trackCompletion = dto.trackCompletion;
    if (dto.projectId !== undefined) data.project = dto.projectId ? { id: dto.projectId } as any : null;
    const event = await this.repository.preload({ id, ...data });
    if (!event) return null;
    return await this.repository.save(event);
  }

  async globalSearch(searchTerm: string, projectId?: number): Promise<any[]> {
    return await globalSimilaritySearch(
      this.repository,
      searchTerm,
      projectId,
      {
        alias: 'e',
        select: ['e.id', 'e.title', 'e.description'],
        scoreColumn: 'e.title',
        searchColumns: ['e.title', 'e.description'],
        projectIdColumn: 'e.projectId',
      },
    );
  }

  async remove(id: number): Promise<{ deleted: boolean }> {
    const event = await this.repository.findOneBy({ id });
    if (!event) return { deleted: false };
    await this.repository.remove(event);
    return { deleted: true };
  }
}

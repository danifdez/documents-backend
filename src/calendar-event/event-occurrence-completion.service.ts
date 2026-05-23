import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventOccurrenceCompletionEntity } from './event-occurrence-completion.entity';
import { CalendarEventEntity } from './calendar-event.entity';

@Injectable()
export class EventOccurrenceCompletionService {
  constructor(
    @InjectRepository(EventOccurrenceCompletionEntity)
    private readonly repo: Repository<EventOccurrenceCompletionEntity>,
    @InjectRepository(CalendarEventEntity)
    private readonly events: Repository<CalendarEventEntity>,
  ) { }

  async markDone(eventId: number, occurrenceDate: Date): Promise<void> {
    const event = await this.events.findOneBy({ id: eventId });
    if (!event) throw new NotFoundException({ error: 'event_not_found' });
    if (!event.trackCompletion) {
      throw new BadRequestException({ error: 'event_not_trackable' });
    }
    await this.repo
      .createQueryBuilder()
      .insert()
      .values({ event: { id: eventId } as any, occurrenceDate })
      .orIgnore()
      .execute();
  }

  async unmarkDone(eventId: number, occurrenceDate: Date): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .delete()
      .where('event_id = :eventId AND occurrence_date = :occurrenceDate', {
        eventId,
        occurrenceDate,
      })
      .execute();
  }
}

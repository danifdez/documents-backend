import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CalendarEventService } from '../../../src/calendar-event/calendar-event.service';
import { CalendarEventEntity } from '../../../src/calendar-event/calendar-event.entity';
import { EventOccurrenceCompletionEntity } from '../../../src/calendar-event/event-occurrence-completion.entity';
import { CalendarEventExpansionService } from '../../../src/calendar-event/calendar-event-expansion.service';
import { createMockRepository, MockRepository } from '../../test-utils';
import { buildCalendarEvent } from '../../factories';

describe('CalendarEventService', () => {
  let service: CalendarEventService;
  let repo: MockRepository<CalendarEventEntity>;
  let completionRepo: MockRepository<EventOccurrenceCompletionEntity>;

  beforeEach(async () => {
    repo = createMockRepository();
    completionRepo = createMockRepository();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CalendarEventService,
        { provide: getRepositoryToken(CalendarEventEntity), useValue: repo },
        {
          provide: getRepositoryToken(EventOccurrenceCompletionEntity),
          useValue: completionRepo,
        },
        CalendarEventExpansionService,
      ],
    }).compile();
    service = module.get(CalendarEventService);
  });

  it('should find all', async () => {
    repo.find.mockResolvedValue([buildCalendarEvent()]);
    expect(await service.findAll()).toHaveLength(1);
  });

  it('should find one', async () => {
    repo.findOne.mockResolvedValue(buildCalendarEvent());
    expect(await service.findOne(1)).toBeDefined();
  });

  it('should find by project', async () => {
    const qb = repo.createQueryBuilder();
    qb.getMany.mockResolvedValue([buildCalendarEvent()]);
    expect(await service.findByProject(1)).toHaveLength(1);
  });

  it('should create event', async () => {
    const e = buildCalendarEvent();
    repo.create.mockReturnValue(e);
    repo.save.mockResolvedValue(e);
    expect(
      await service.create({ title: 'Test', startDate: new Date() }),
    ).toEqual(e);
  });

  it('should remove event', async () => {
    const e = buildCalendarEvent();
    repo.findOneBy.mockResolvedValue(e);
    repo.remove.mockResolvedValue(e);
    await service.remove(1);
    expect(repo.remove).toHaveBeenCalled();
  });

  it('expands recurring events and applies completions in date order', async () => {
    const date = (day: number, hour = 9) =>
      new Date(Date.UTC(2026, 0, day, hour));
    const tracked = buildCalendarEvent({
      id: 10,
      title: 'Daily review',
      startDate: date(1),
      endDate: date(1, 10),
      recurrenceRule: 'FREQ=DAILY;COUNT=3',
      trackCompletion: true,
    });
    const other = buildCalendarEvent({
      id: 11,
      title: 'Untracked',
      startDate: date(2, 8),
    });
    const qb = repo.createQueryBuilder();
    qb.getMany.mockResolvedValue([other, tracked]);
    const completions = completionRepo.createQueryBuilder();
    completions.getRawMany.mockResolvedValue([
      { eventId: 10, occurrenceDate: date(1) },
      { eventId: 10, occurrenceDate: date(3) },
    ]);
    const start = date(1).toISOString();
    const end = date(3, 12).toISOString();
    const results = await service.findByDateRange(start, end, 2);
    expect(
      results.map(({ id, occurrenceStart, occurrenceEnd, completed }) => ({
        id,
        occurrenceStart,
        occurrenceEnd,
        completed,
      })),
    ).toEqual([
      {
        id: 10,
        occurrenceStart: date(1),
        occurrenceEnd: date(1, 10),
        completed: true,
      },
      {
        id: 11,
        occurrenceStart: date(2, 8),
        occurrenceEnd: null,
        completed: false,
      },
      {
        id: 10,
        occurrenceStart: date(2),
        occurrenceEnd: date(2, 10),
        completed: false,
      },
      {
        id: 10,
        occurrenceStart: date(3),
        occurrenceEnd: date(3, 10),
        completed: true,
      },
    ]);
    expect(qb.andWhere).toHaveBeenCalledWith('e.projectId = :projectId', {
      projectId: 2,
    });
    expect(completions.where).toHaveBeenCalledWith(
      'c.event_id IN (:...eventIds)',
      { eventIds: [10] },
    );
    expect(completions.andWhere).toHaveBeenCalledWith(
      'c.occurrence_date BETWEEN :start AND :end',
      {
        start: new Date(start),
        end: new Date(end),
      },
    );
  });

  it('skips the completion lookup for nontracked events and limits the date range', async () => {
    const event = buildCalendarEvent({
      startDate: new Date('2026-02-01T09:00:00Z'),
    });
    const qb = repo.createQueryBuilder();
    qb.getMany.mockResolvedValue([event]);
    await expect(
      service.findByDateRange('2026-01-01', '2026-01-31'),
    ).resolves.toEqual([]);
    expect(completionRepo.createQueryBuilder).not.toHaveBeenCalled();
    expect(qb.andWhere).not.toHaveBeenCalled();
    await expect(service.globalSearch('Review', 2)).resolves.toEqual([]);
    expect(qb.andWhere).toHaveBeenCalledWith('e.projectId = :projectId', {
      projectId: 2,
    });
  });

  it('saves optional fields on create and clears a project assignment on update', async () => {
    const details = {
      title: 'Review',
      description: 'Notes',
      startDate: new Date('2026-02-01T09:00:00Z'),
      endDate: new Date('2026-02-01T10:00:00Z'),
      color: '#000000',
      allDay: false,
      recurrenceRule: 'FREQ=DAILY',
      alarm: null,
      trackCompletion: true,
    };
    repo.create.mockImplementation((data) => data);
    repo.save.mockImplementation(async (data) => data);
    await expect(service.create({ ...details, projectId: 2 })).resolves.toEqual(
      { ...details, project: { id: 2 } },
    );
    repo.preload
      .mockResolvedValueOnce(null)
      .mockImplementation(async (data) => data);
    await expect(service.update(999, {})).resolves.toBeNull();
    await expect(
      service.update(1, { ...details, projectId: 2 }),
    ).resolves.toEqual({ ...details, id: 1, project: { id: 2 } });
    await expect(
      service.update(1, {
        projectId: null,
        recurrenceRule: null,
        trackCompletion: false,
      }),
    ).resolves.toEqual({
      id: 1,
      project: null,
      recurrenceRule: null,
      trackCompletion: false,
    });
    await expect(service.remove(999)).resolves.toEqual({ deleted: false });
    expect(repo.remove).not.toHaveBeenCalled();
  });
});

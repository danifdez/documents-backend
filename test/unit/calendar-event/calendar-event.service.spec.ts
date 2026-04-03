import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CalendarEventService } from '../../../src/calendar-event/calendar-event.service';
import { CalendarEventEntity } from '../../../src/calendar-event/calendar-event.entity';
import { createMockRepository, MockRepository } from '../../test-utils';
import { buildCalendarEvent } from '../../factories';

describe('CalendarEventService', () => {
  let service: CalendarEventService;
  let repo: MockRepository<CalendarEventEntity>;

  beforeEach(async () => {
    repo = createMockRepository();
    const module: TestingModule = await Test.createTestingModule({
      providers: [CalendarEventService, { provide: getRepositoryToken(CalendarEventEntity), useValue: repo }],
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
    expect(await service.create({ title: 'Test', startDate: new Date() })).toEqual(e);
  });

  it('should remove event', async () => {
    const e = buildCalendarEvent();
    repo.findOneBy.mockResolvedValue(e);
    repo.remove.mockResolvedValue(e);
    await service.remove(1);
    expect(repo.remove).toHaveBeenCalled();
  });
});

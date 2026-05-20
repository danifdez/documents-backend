import {
  CalendarEventSchedulerService,
  SCHEDULER_TICK_KEY,
} from '../../../src/calendar-event/calendar-event-scheduler.service';
import { CalendarEventExpansionService } from '../../../src/calendar-event/calendar-event-expansion.service';
import { CalendarEventEntity } from '../../../src/calendar-event/calendar-event.entity';

function makeEvent(overrides: Partial<CalendarEventEntity>): CalendarEventEntity {
  const base: any = {
    id: 1,
    title: 'evt',
    description: null,
    startDate: new Date('2026-05-18T10:00:00Z'),
    endDate: null,
    color: '#3b82f6',
    allDay: false,
    recurrenceRule: null,
    alarm: null,
    project: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return Object.assign(base, overrides);
}

function buildSvc({
  events = [],
  previousTick = null,
}: { events?: CalendarEventEntity[]; previousTick?: Date | null } = {}) {
  const repo = { find: jest.fn().mockResolvedValue(events) };
  const appState = {
    getTimestamp: jest.fn().mockResolvedValue(previousTick),
    setTimestamp: jest.fn().mockResolvedValue(undefined),
  };
  const gateway = {
    sendCalendarAlarm: jest.fn(),
    sendCalendarMissed: jest.fn(),
  };
  const expansion = new CalendarEventExpansionService();
  const svc = new CalendarEventSchedulerService(
    repo as any,
    expansion,
    appState as any,
    gateway as any,
  );
  return { svc, repo, appState, gateway };
}

describe('CalendarEventSchedulerService', () => {
  it('initializes lastTick to now and emits nothing on first run', async () => {
    const { svc, gateway, appState } = buildSvc({ previousTick: null });
    const now = new Date('2026-05-18T10:00:00Z');
    await svc.tick(now);
    expect(gateway.sendCalendarAlarm).not.toHaveBeenCalled();
    expect(gateway.sendCalendarMissed).not.toHaveBeenCalled();
    expect(appState.setTimestamp).toHaveBeenCalledWith(SCHEDULER_TICK_KEY, now);
  });

  it('emits a single calendar:alarm for a recent one-shot alarm', async () => {
    const event = makeEvent({
      id: 7,
      title: 'pill',
      startDate: new Date('2026-05-18T10:00:30Z'),
      alarm: { offsetMinutes: 0, label: 'remember' },
    });
    const previousTick = new Date('2026-05-18T10:00:00Z');
    const now = new Date('2026-05-18T10:01:00Z');
    const { svc, gateway, appState } = buildSvc({ events: [event], previousTick });
    await svc.tick(now);
    expect(gateway.sendCalendarAlarm).toHaveBeenCalledTimes(1);
    expect(gateway.sendCalendarAlarm).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 7, title: 'pill', alarmLabel: 'remember' }),
    );
    expect(gateway.sendCalendarMissed).not.toHaveBeenCalled();
    expect(appState.setTimestamp).toHaveBeenCalledWith(SCHEDULER_TICK_KEY, now);
  });

  it('classifies an alarm older than 5 minutes as lost (single aggregate)', async () => {
    const event = makeEvent({
      id: 9,
      startDate: new Date('2026-05-18T09:50:00Z'),
      alarm: { offsetMinutes: 0 },
    });
    const previousTick = new Date('2026-05-18T09:00:00Z');
    const now = new Date('2026-05-18T10:00:00Z');
    const { svc, gateway } = buildSvc({ events: [event], previousTick });
    await svc.tick(now);
    expect(gateway.sendCalendarAlarm).not.toHaveBeenCalled();
    expect(gateway.sendCalendarMissed).toHaveBeenCalledTimes(1);
    expect(gateway.sendCalendarMissed).toHaveBeenCalledWith({
      items: [expect.objectContaining({ eventId: 9 })],
    });
  });

  it('does not emit calendar:missed when lost array is empty', async () => {
    const previousTick = new Date('2026-05-18T09:59:00Z');
    const now = new Date('2026-05-18T10:00:00Z');
    const { svc, gateway } = buildSvc({ events: [], previousTick });
    await svc.tick(now);
    expect(gateway.sendCalendarMissed).not.toHaveBeenCalled();
  });

  it('ignores events with alarm=null', async () => {
    const event = makeEvent({
      startDate: new Date('2026-05-18T09:00:00Z'),
      alarm: null,
    });
    const previousTick = new Date('2026-05-18T08:00:00Z');
    const now = new Date('2026-05-18T10:00:00Z');
    // repo.find filters by `alarm: Not(IsNull())` — the mock returns whatever we feed,
    // but the service still skips events whose alarm became null in memory.
    const { svc, gateway } = buildSvc({ events: [event], previousTick });
    await svc.tick(now);
    expect(gateway.sendCalendarAlarm).not.toHaveBeenCalled();
    expect(gateway.sendCalendarMissed).not.toHaveBeenCalled();
  });

  it('does not advance the tick when emit fails', async () => {
    const event = makeEvent({
      startDate: new Date('2026-05-18T10:00:30Z'),
      alarm: { offsetMinutes: 0 },
    });
    const previousTick = new Date('2026-05-18T10:00:00Z');
    const now = new Date('2026-05-18T10:01:00Z');
    const { svc, gateway, appState } = buildSvc({ events: [event], previousTick });
    (gateway.sendCalendarAlarm as jest.Mock).mockImplementation(() => {
      throw new Error('socket boom');
    });
    await svc.tick(now);
    expect(appState.setTimestamp).not.toHaveBeenCalled();
  });

  it('expands recurrence and emits each alarm in the window', async () => {
    const event = makeEvent({
      id: 22,
      startDate: new Date('2026-05-18T10:00:00Z'),
      recurrenceRule: 'FREQ=MINUTELY;COUNT=3',
      alarm: { offsetMinutes: 0 },
    });
    const previousTick = new Date('2026-05-18T09:59:00Z');
    const now = new Date('2026-05-18T10:02:30Z');
    const { svc, gateway } = buildSvc({ events: [event], previousTick });
    await svc.tick(now);
    expect(gateway.sendCalendarAlarm).toHaveBeenCalledTimes(3);
  });
});

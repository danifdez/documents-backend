import { CalendarEventExpansionService } from '../../../src/calendar-event/calendar-event-expansion.service';
import { CalendarEventEntity } from '../../../src/calendar-event/calendar-event.entity';

function makeEvent(overrides: Partial<CalendarEventEntity>): CalendarEventEntity {
  const base: any = {
    id: 1,
    title: 'event',
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

describe('CalendarEventExpansionService', () => {
  let svc: CalendarEventExpansionService;
  beforeEach(() => {
    svc = new CalendarEventExpansionService();
  });

  it('returns the single occurrence when one-shot event is inside the range', () => {
    const ev = makeEvent({ startDate: new Date('2026-05-20T10:00:00Z') });
    const r = svc.expand(ev, new Date('2026-05-18T00:00:00Z'), new Date('2026-05-30T00:00:00Z'));
    expect(r).toHaveLength(1);
    expect(r[0].occurrenceStart.toISOString()).toBe('2026-05-20T10:00:00.000Z');
    expect(r[0].alarmTriggerAt).toBeNull();
    expect(r[0].occurrenceEnd).toBeNull();
  });

  it('returns empty when one-shot is outside the range', () => {
    const ev = makeEvent({ startDate: new Date('2026-04-01T10:00:00Z') });
    const r = svc.expand(ev, new Date('2026-05-18T00:00:00Z'), new Date('2026-05-30T00:00:00Z'));
    expect(r).toEqual([]);
  });

  it('expands FREQ=DAILY;COUNT=7 to 7 daily occurrences', () => {
    const ev = makeEvent({
      startDate: new Date('2026-05-18T22:00:00Z'),
      recurrenceRule: 'FREQ=DAILY;COUNT=7',
    });
    const r = svc.expand(
      ev,
      new Date('2026-05-18T00:00:00Z'),
      new Date('2026-06-01T00:00:00Z'),
    );
    expect(r).toHaveLength(7);
    expect(r[0].occurrenceStart.toISOString()).toBe('2026-05-18T22:00:00.000Z');
    expect(r[6].occurrenceStart.toISOString()).toBe('2026-05-24T22:00:00.000Z');
  });

  it('expands FREQ=DAILY;INTERVAL=3', () => {
    const ev = makeEvent({
      startDate: new Date('2026-05-18T10:00:00Z'),
      recurrenceRule: 'FREQ=DAILY;INTERVAL=3;COUNT=4',
    });
    const r = svc.expand(
      ev,
      new Date('2026-05-18T00:00:00Z'),
      new Date('2026-06-01T00:00:00Z'),
    );
    expect(r).toHaveLength(4);
    const isoDays = r.map((o) => o.occurrenceStart.toISOString().slice(0, 10));
    expect(isoDays).toEqual(['2026-05-18', '2026-05-21', '2026-05-24', '2026-05-27']);
  });

  it('expands FREQ=WEEKLY;BYDAY=MO to only mondays', () => {
    // 2026-05-18 is a Monday.
    const ev = makeEvent({
      startDate: new Date('2026-05-18T09:00:00Z'),
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=4',
    });
    const r = svc.expand(
      ev,
      new Date('2026-05-01T00:00:00Z'),
      new Date('2026-07-01T00:00:00Z'),
    );
    expect(r).toHaveLength(4);
    r.forEach((o) => expect(o.occurrenceStart.getUTCDay()).toBe(1));
  });

  it('computes alarmTriggerAt as occurrenceStart + offsetMinutes', () => {
    const ev = makeEvent({
      startDate: new Date('2026-05-18T22:00:00Z'),
      recurrenceRule: 'FREQ=DAILY;COUNT=3',
      alarm: { offsetMinutes: -60 },
    });
    const r = svc.expand(
      ev,
      new Date('2026-05-18T00:00:00Z'),
      new Date('2026-05-30T00:00:00Z'),
    );
    expect(r).toHaveLength(3);
    expect(r[0].alarmTriggerAt?.toISOString()).toBe('2026-05-18T21:00:00.000Z');
    expect(r[1].alarmTriggerAt?.toISOString()).toBe('2026-05-19T21:00:00.000Z');
  });

  it('leaves alarmTriggerAt null when no alarm', () => {
    const ev = makeEvent({
      startDate: new Date('2026-05-18T22:00:00Z'),
      recurrenceRule: 'FREQ=DAILY;COUNT=3',
    });
    const r = svc.expand(
      ev,
      new Date('2026-05-18T00:00:00Z'),
      new Date('2026-05-30T00:00:00Z'),
    );
    r.forEach((o) => expect(o.alarmTriggerAt).toBeNull());
  });

  it('throws InvalidRecurrenceRule when rule is unparseable', () => {
    const ev = makeEvent({
      startDate: new Date('2026-05-18T10:00:00Z'),
      recurrenceRule: 'FREQ=NOPE',
    });
    expect(() =>
      svc.expand(
        ev,
        new Date('2026-05-18T00:00:00Z'),
        new Date('2026-05-30T00:00:00Z'),
      ),
    ).toThrow(/InvalidRecurrenceRule/);
  });

  it('keeps local wall-clock fixed across DST boundary with tz', () => {
    // Europe/Madrid switches from CET (UTC+1) to CEST (UTC+2) on the last Sunday of March (2026-03-29).
    // A daily 22:00 event starting 2026-03-28 should land on 2026-03-28 22:00 Madrid = 21:00 UTC,
    // and 2026-03-29 22:00 Madrid = 20:00 UTC.
    const ev = makeEvent({
      startDate: new Date('2026-03-28T21:00:00Z'),
      recurrenceRule: 'FREQ=DAILY;COUNT=3',
    });
    const r = svc.expand(
      ev,
      new Date('2026-03-27T00:00:00Z'),
      new Date('2026-04-05T00:00:00Z'),
      'Europe/Madrid',
    );
    expect(r).toHaveLength(3);
    expect(r[0].occurrenceStart.toISOString()).toBe('2026-03-28T21:00:00.000Z');
    expect(r[1].occurrenceStart.toISOString()).toBe('2026-03-29T20:00:00.000Z');
    expect(r[2].occurrenceStart.toISOString()).toBe('2026-03-30T20:00:00.000Z');
  });
});

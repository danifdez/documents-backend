import { Injectable, BadRequestException } from '@nestjs/common';
import { RRule } from 'rrule';
import { CalendarEventEntity } from './calendar-event.entity';

export interface OccurrenceDescriptor {
  eventId: number;
  title: string;
  occurrenceStart: Date;
  occurrenceEnd: Date | null;
  alarmTriggerAt: Date | null;
  completed: boolean;
}

@Injectable()
export class CalendarEventExpansionService {
  expand(
    event: CalendarEventEntity,
    rangeStart: Date,
    rangeEnd: Date,
    tz?: string,
    completedOccurrences?: Set<string>,
  ): OccurrenceDescriptor[] {
    if (rangeEnd < rangeStart) return [];
    const durationMs = event.endDate
      ? new Date(event.endDate).getTime() - new Date(event.startDate).getTime()
      : null;
    const offsetMs = event.alarm ? event.alarm.offsetMinutes * 60_000 : null;

    const buildOccurrence = (start: Date): OccurrenceDescriptor => ({
      eventId: event.id,
      title: event.title,
      occurrenceStart: start,
      occurrenceEnd: durationMs !== null ? new Date(start.getTime() + durationMs) : null,
      alarmTriggerAt: offsetMs !== null ? new Date(start.getTime() + offsetMs) : null,
      completed: completedOccurrences?.has(start.toISOString()) ?? false,
    });

    if (!event.recurrenceRule) {
      const start = new Date(event.startDate);
      if (start >= rangeStart && start <= rangeEnd) {
        return [buildOccurrence(start)];
      }
      return [];
    }

    let rule: RRule;
    try {
      rule = this.buildRule(event.recurrenceRule, new Date(event.startDate), tz);
    } catch (err: any) {
      throw new BadRequestException(
        `InvalidRecurrenceRule: ${err?.message ?? 'failed to parse RRULE'}`,
      );
    }

    const occurrences = rule.between(rangeStart, rangeEnd, true);
    return occurrences.map((d) => buildOccurrence(this.normalizeRRuleDate(d, tz)));
  }

  private buildRule(rrule: string, dtstart: Date, tz?: string): RRule {
    const cleaned = rrule.startsWith('RRULE:') ? rrule.slice('RRULE:'.length) : rrule;
    const options = RRule.parseString(cleaned);
    if (tz) {
      // rrule.js with tzid expects dtstart's UTC components to encode the
      // wall-clock time in tz. Convert real-UTC → floating-wall-clock so the
      // recurrence walks days in tz local time (DST-correct).
      options.dtstart = this.utcToZonedFloating(dtstart, tz);
      options.tzid = tz;
    } else {
      options.dtstart = dtstart;
    }
    return new RRule(options);
  }

  private utcToZonedFloating(d: Date, tz: string): Date {
    const parts = this.formatParts(d, tz);
    return new Date(
      Date.UTC(parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second),
    );
  }

  /**
   * rrule.js with tzid returns "floating" Date objects whose UTC components
   * encode the wall-clock time in the given tz. Convert them back to true
   * UTC by reinterpreting the wall-clock components as if they were in `tz`.
   */
  private normalizeRRuleDate(d: Date, tz?: string): Date {
    if (!tz) return new Date(d);
    const wallClock = {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth(),
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds(),
      ms: d.getUTCMilliseconds(),
    };
    return new Date(this.zonedTimeToUtcMs(wallClock, tz));
  }

  private zonedTimeToUtcMs(
    wc: { year: number; month: number; day: number; hour: number; minute: number; second: number; ms: number },
    tz: string,
  ): number {
    // Build a UTC "guess" then correct by the offset that tz reports for that instant.
    const guess = Date.UTC(wc.year, wc.month, wc.day, wc.hour, wc.minute, wc.second, wc.ms);
    const offsetMin = this.tzOffsetMinutes(new Date(guess), tz);
    return guess - offsetMin * 60_000;
  }

  private tzOffsetMinutes(date: Date, tz: string): number {
    const parts = this.formatParts(date, tz);
    const asUtc = Date.UTC(parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second);
    return (asUtc - date.getTime()) / 60_000;
  }

  private formatParts(
    date: Date,
    tz: string,
  ): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const map = dtf.formatToParts(date).reduce<Record<string, string>>((acc, p) => {
      if (p.type !== 'literal') acc[p.type] = p.value;
      return acc;
    }, {});
    const hour = Number(map.hour) === 24 ? 0 : Number(map.hour);
    return {
      year: Number(map.year),
      month: Number(map.month) - 1,
      day: Number(map.day),
      hour,
      minute: Number(map.minute),
      second: Number(map.second),
    };
  }
}

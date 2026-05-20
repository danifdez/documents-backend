import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { CalendarEventEntity } from './calendar-event.entity';
import { CalendarEventExpansionService } from './calendar-event-expansion.service';
import { AppStateService } from '../app-state/app-state.service';
import { NotificationGateway } from '../notification/notification.gateway';

export const SCHEDULER_TICK_KEY = 'calendar.last_scheduler_tick_at';
export const LOST_THRESHOLD_MS = 5 * 60 * 1000;

interface AlarmItem {
  eventId: number;
  occurrenceStart: string;
  title: string;
  alarmLabel: string | null;
}

@Injectable()
export class CalendarEventSchedulerService {
  private readonly logger = new Logger(CalendarEventSchedulerService.name);

  constructor(
    @InjectRepository(CalendarEventEntity)
    private readonly repo: Repository<CalendarEventEntity>,
    private readonly expansion: CalendarEventExpansionService,
    private readonly appState: AppStateService,
    private readonly gateway: NotificationGateway,
  ) { }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron(): Promise<void> {
    await this.tick(new Date());
  }

  async tick(now: Date): Promise<void> {
    const previousTick = await this.appState.getTimestamp(SCHEDULER_TICK_KEY);
    if (previousTick === null) {
      await this.appState.setTimestamp(SCHEDULER_TICK_KEY, now);
      return;
    }
    if (now <= previousTick) return;

    try {
      const candidates = await this.repo.find({
        where: { alarm: Not(IsNull()) },
      });

      const recent: AlarmItem[] = [];
      const lost: AlarmItem[] = [];

      const serverTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      // Holgura amplia para cubrir offsets negativos.
      const expandFrom = new Date(previousTick.getTime() - 7 * 24 * 60 * 60_000);
      const expandTo = new Date(now.getTime() + 7 * 24 * 60 * 60_000);

      for (const event of candidates) {
        if (!event.alarm) continue;
        let occurrences;
        try {
          occurrences = this.expansion.expand(event, expandFrom, expandTo, serverTz);
        } catch (err: any) {
          this.logger.warn(
            `Skipping event ${event.id}: ${err?.message ?? 'expansion failed'}`,
          );
          continue;
        }
        for (const o of occurrences) {
          if (!o.alarmTriggerAt) continue;
          if (o.alarmTriggerAt <= previousTick) continue;
          if (o.alarmTriggerAt > now) continue;
          const item: AlarmItem = {
            eventId: event.id,
            occurrenceStart: o.occurrenceStart.toISOString(),
            title: event.title,
            alarmLabel: event.alarm.label ?? null,
          };
          const delay = now.getTime() - o.alarmTriggerAt.getTime();
          if (delay > LOST_THRESHOLD_MS) lost.push(item);
          else recent.push(item);
        }
      }

      for (const item of recent) this.gateway.sendCalendarAlarm(item);
      if (lost.length > 0) this.gateway.sendCalendarMissed({ items: lost });

      await this.appState.setTimestamp(SCHEDULER_TICK_KEY, now);
    } catch (err: any) {
      this.logger.error(`Scheduler tick failed; tick not advanced: ${err?.message ?? err}`);
    }
  }
}

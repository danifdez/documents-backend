// Despite the name, this service dispatches BOTH calendar event alarms and
// user-task reminders. Both domains share the same tick and
// the same `calendar.last_scheduler_tick_at` key in `app_state` so the rolling
// window stays consistent between them. Rename only if a third domain joins.
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { CalendarEventEntity } from './calendar-event.entity';
import { EventOccurrenceCompletionEntity } from './event-occurrence-completion.entity';
import { CalendarEventExpansionService } from './calendar-event-expansion.service';
import { AppStateService } from '../app-state/app-state.service';
import { NotificationGateway } from '../notification/notification.gateway';
import { UserTaskEntity } from '../user-task/user-task.entity';

export const SCHEDULER_TICK_KEY = 'calendar.last_scheduler_tick_at';
export const LOST_THRESHOLD_MS = 5 * 60 * 1000;

interface AlarmItem {
  eventId: number;
  occurrenceStart: string;
  title: string;
  alarmLabel: string | null;
  trackCompletion: boolean;
}

interface TaskReminderItem {
  taskId: number;
  title: string;
  reminderAt: string;
}

@Injectable()
export class CalendarEventSchedulerService {
  private readonly logger = new Logger(CalendarEventSchedulerService.name);

  constructor(
    @InjectRepository(CalendarEventEntity)
    private readonly repo: Repository<CalendarEventEntity>,
    @InjectRepository(EventOccurrenceCompletionEntity)
    private readonly completionRepo: Repository<EventOccurrenceCompletionEntity>,
    @InjectRepository(UserTaskEntity)
    private readonly taskRepo: Repository<UserTaskEntity>,
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
      await this.processCalendarAlarms(previousTick, now);
      await this.processTaskReminders(previousTick, now);
      await this.appState.setTimestamp(SCHEDULER_TICK_KEY, now);
    } catch (err: any) {
      this.logger.error(`Scheduler tick failed; tick not advanced: ${err?.message ?? err}`);
    }
  }

  private async processCalendarAlarms(previousTick: Date, now: Date): Promise<void> {
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
          trackCompletion: event.trackCompletion,
        };
        const delay = now.getTime() - o.alarmTriggerAt.getTime();
        if (delay > LOST_THRESHOLD_MS) lost.push(item);
        else recent.push(item);
      }
    }

    for (const item of recent) this.gateway.sendCalendarAlarm(item);
    const filteredLost = await this.filterAlreadyCompleted(lost);
    if (filteredLost.length > 0) this.gateway.sendCalendarMissed({ items: filteredLost });
  }

  private async processTaskReminders(previousTick: Date, now: Date): Promise<void> {
    // 30-day backlog window so tasks whose reminder fired during a long
    // downtime still emerge as `lost`. No forward slack: tasks with a future
    // reminder fire in their own tick.
    const earliest = new Date(previousTick.getTime() - 30 * 24 * 60 * 60_000);
    const tasks = await this.taskRepo
      .createQueryBuilder('t')
      .where('t.reminder_at IS NOT NULL')
      .andWhere('t.status = :status', { status: 'pending' })
      .andWhere('t.reminder_at > :earliest', { earliest })
      .andWhere('t.reminder_at <= :now', { now })
      .getMany();

    const recent: TaskReminderItem[] = [];
    const lost: TaskReminderItem[] = [];

    for (const task of tasks) {
      if (!task.reminderAt) continue;
      const reminderAt = new Date(task.reminderAt);
      // If the reminder fired before the previous tick AND we are still
      // within the lost threshold, the previous tick already handled it.
      // Beyond the threshold we surface it as lost.
      if (reminderAt <= previousTick) {
        const delay = now.getTime() - reminderAt.getTime();
        if (delay > LOST_THRESHOLD_MS) {
          lost.push({
            taskId: task.id,
            title: task.title,
            reminderAt: reminderAt.toISOString(),
          });
        }
        continue;
      }
      const delay = now.getTime() - reminderAt.getTime();
      const item: TaskReminderItem = {
        taskId: task.id,
        title: task.title,
        reminderAt: reminderAt.toISOString(),
      };
      if (delay > LOST_THRESHOLD_MS) lost.push(item);
      else recent.push(item);
    }

    for (const item of recent) this.gateway.sendTaskReminder(item);
    if (lost.length > 0) this.gateway.sendTaskMissed({ items: lost });
  }

  private async filterAlreadyCompleted(items: AlarmItem[]): Promise<AlarmItem[]> {
    const trackable = items.filter((i) => i.trackCompletion);
    if (trackable.length === 0) return items;
    const eventIds = Array.from(new Set(trackable.map((i) => i.eventId)));
    const rows = await this.completionRepo
      .createQueryBuilder('c')
      .select('c.event_id', 'eventId')
      .addSelect('c.occurrence_date', 'occurrenceDate')
      .where('c.event_id IN (:...eventIds)', { eventIds })
      .getRawMany<{ eventId: number; occurrenceDate: Date }>();
    const completed = new Set(
      rows.map((r) => `${r.eventId}@${new Date(r.occurrenceDate).toISOString()}`),
    );
    return items.filter((i) => {
      if (!i.trackCompletion) return true;
      return !completed.has(`${i.eventId}@${i.occurrenceStart}`);
    });
  }
}

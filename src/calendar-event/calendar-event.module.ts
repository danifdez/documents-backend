import { Module } from '@nestjs/common';
import { CalendarEventController } from './calendar-event.controller';
import { CalendarEventService } from './calendar-event.service';
import { CalendarEventExpansionService } from './calendar-event-expansion.service';
import { CalendarEventSchedulerService } from './calendar-event-scheduler.service';
import { EventOccurrenceCompletionService } from './event-occurrence-completion.service';
import { DatabaseModule } from '../database/database.module';
import { AppStateModule } from '../app-state/app-state.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [DatabaseModule, AppStateModule, NotificationModule],
  controllers: [CalendarEventController],
  providers: [
    CalendarEventService,
    CalendarEventExpansionService,
    CalendarEventSchedulerService,
    EventOccurrenceCompletionService,
  ],
  exports: [CalendarEventService, CalendarEventExpansionService],
})
export class CalendarEventModule { }

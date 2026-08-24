import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { NotificationModule } from '../notification/notification.module';
import { ExecutionOutboxService } from './execution-outbox.service';

@Module({
  imports: [DatabaseModule, NotificationModule],
  providers: [ExecutionOutboxService],
  exports: [ExecutionOutboxService],
})
export class ExecutionOutboxModule {}

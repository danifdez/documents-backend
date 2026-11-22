import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { NotificationModule } from '../notification/notification.module';
import { ExecutionOutboxService } from './execution-outbox.service';
import { ExecutionPublicationStore } from './execution-publication.store';

@Module({
  imports: [DatabaseModule, NotificationModule],
  providers: [ExecutionOutboxService, ExecutionPublicationStore],
  exports: [ExecutionOutboxService],
})
export class ExecutionOutboxModule {}

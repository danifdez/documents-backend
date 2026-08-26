import { Module } from '@nestjs/common';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { DatabaseModule } from '../database/database.module';
import { NotificationModule } from '../notification/notification.module';
import { ExecutionModule } from '../execution/execution.module';
import { IndexedFileModule } from '../indexed-file/indexed-file.module';

@Module({
  imports: [
    DatabaseModule,
    ExecutionModule,
    NotificationModule,
    IndexedFileModule,
  ],
  controllers: [AssistantController],
  providers: [AssistantService],
  exports: [AssistantService],
})
export class AssistantModule {}

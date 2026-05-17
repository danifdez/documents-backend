import { Module, forwardRef } from '@nestjs/common';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { DatabaseModule } from '../database/database.module';
import { JobModule } from '../job/job.module';
import { AssistantMemoryModule } from '../assistant-memory/assistant-memory.module';
import { NotificationModule } from '../notification/notification.module';
import { IndexedFileModule } from '../indexed-file/indexed-file.module';

@Module({
  imports: [
    DatabaseModule,
    JobModule,
    AssistantMemoryModule,
    NotificationModule,
    forwardRef(() => IndexedFileModule),
  ],
  controllers: [AssistantController],
  providers: [AssistantService],
  exports: [AssistantService],
})
export class AssistantModule {}

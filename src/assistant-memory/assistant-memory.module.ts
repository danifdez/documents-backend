import { Module } from '@nestjs/common';
import { AssistantMemoryController } from './assistant-memory.controller';
import { AssistantMemoryService } from './assistant-memory.service';
import { DatabaseModule } from '../database/database.module';
import { JobModule } from '../job/job.module';

@Module({
  imports: [DatabaseModule, JobModule],
  controllers: [AssistantMemoryController],
  providers: [AssistantMemoryService],
  exports: [AssistantMemoryService],
})
export class AssistantMemoryModule {}

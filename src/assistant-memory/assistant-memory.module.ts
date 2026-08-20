import { Module } from '@nestjs/common';
import { AssistantMemoryController } from './assistant-memory.controller';
import { AssistantMemoryService } from './assistant-memory.service';
import { DatabaseModule } from '../database/database.module';
import { ExecutionModule } from '../execution/execution.module';

@Module({
  imports: [DatabaseModule, ExecutionModule],
  controllers: [AssistantMemoryController],
  providers: [AssistantMemoryService],
  exports: [AssistantMemoryService],
})
export class AssistantMemoryModule {}

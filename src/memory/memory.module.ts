import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import {
  AgentMemoryController,
  AssistantMemoryController,
} from './memory.controller';
import { MemoryService } from './memory.service';

@Module({
  imports: [DatabaseModule],
  controllers: [AssistantMemoryController, AgentMemoryController],
  providers: [MemoryService],
  exports: [MemoryService],
})
export class MemoryModule {}

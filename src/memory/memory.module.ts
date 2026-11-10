import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import {
  AgentMemoryController,
  AssistantMemoryController,
} from './memory.controller';
import { MemoryService } from './memory.service';
import { OwnershipModule } from '../auth/ownership.module';

@Module({
  imports: [DatabaseModule, OwnershipModule],
  controllers: [AssistantMemoryController, AgentMemoryController],
  providers: [MemoryService],
  exports: [MemoryService],
})
export class MemoryModule {}

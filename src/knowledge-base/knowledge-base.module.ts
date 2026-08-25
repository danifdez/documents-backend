import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ExecutionModule } from '../execution/execution.module';
import { KnowledgeEntryController } from './knowledge-entry.controller';
import { KnowledgeEntryService } from './knowledge-entry.service';
import { VectorModule } from '../vector/vector.module';

@Module({
  imports: [DatabaseModule, ExecutionModule, VectorModule],
  controllers: [KnowledgeEntryController],
  providers: [KnowledgeEntryService],
  exports: [KnowledgeEntryService],
})
export class KnowledgeBaseModule {}

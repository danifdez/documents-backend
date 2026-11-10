import { Module } from '@nestjs/common';
import {
  AgentIndexedFileController,
  AssistantIndexedFileController,
} from './indexed-file.controller';
import { IndexedFileService } from './indexed-file.service';
import { IndexedFileBootstrapService } from './indexed-file-bootstrap.service';
import { DatabaseModule } from '../database/database.module';
import { ExecutionModule } from '../execution/execution.module';
import { VectorModule } from '../vector/vector.module';
import { OwnershipModule } from '../auth/ownership.module';

@Module({
  imports: [DatabaseModule, ExecutionModule, VectorModule, OwnershipModule],
  controllers: [AssistantIndexedFileController, AgentIndexedFileController],
  providers: [IndexedFileService, IndexedFileBootstrapService],
  exports: [IndexedFileService],
})
export class IndexedFileModule {}

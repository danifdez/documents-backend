import { Module } from '@nestjs/common';
import {
  AssistantIndexedFileController,
  AgentIndexedFileController,
} from './indexed-file.controller';
import { IndexedFileService } from './indexed-file.service';
import { IndexedFileBootstrapService } from './indexed-file-bootstrap.service';
import { DatabaseModule } from '../database/database.module';
import { ExecutionModule } from '../execution/execution.module';

@Module({
  imports: [DatabaseModule, ExecutionModule],
  controllers: [AssistantIndexedFileController, AgentIndexedFileController],
  providers: [IndexedFileService, IndexedFileBootstrapService],
  exports: [IndexedFileService],
})
export class IndexedFileModule {}

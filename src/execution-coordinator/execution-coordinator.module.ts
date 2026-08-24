import { Module } from '@nestjs/common';
import { ExecutionProcessorModule } from '../execution-processor/execution-processor.module';
import { ExecutionModule } from '../execution/execution.module';
import { ExecutionCoordinatorService } from './execution-coordinator.service';
import { ExecutionOutboxModule } from '../execution-outbox/execution-outbox.module';
import { SearchModule } from '../search/search.module';
import { SearchService } from '../search/search.service';
import {
  DOCUMENT_SEARCH_PROVIDER,
  ExecutionToolRuntimeService,
} from './execution-tool-runtime.service';
import { ExecutionAgentLoopService } from './execution-agent-loop.service';

@Module({
  imports: [
    ExecutionModule,
    ExecutionProcessorModule.register(),
    ExecutionOutboxModule,
    SearchModule,
  ],
  providers: [
    ExecutionCoordinatorService,
    ExecutionAgentLoopService,
    ExecutionToolRuntimeService,
    { provide: DOCUMENT_SEARCH_PROVIDER, useExisting: SearchService },
  ],
  exports: [ExecutionCoordinatorService],
})
export class ExecutionCoordinatorModule {}

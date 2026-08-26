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
import { UserTaskModule } from '../user-task/user-task.module';
import { UserTaskService } from '../user-task/user-task.service';
import { USER_TASK_CREATE_PROVIDER } from './execution-tool-runtime.service';

@Module({
  imports: [
    ExecutionModule,
    ExecutionProcessorModule.register(),
    ExecutionOutboxModule,
    SearchModule,
    UserTaskModule,
  ],
  providers: [
    ExecutionCoordinatorService,
    ExecutionAgentLoopService,
    ExecutionToolRuntimeService,
    { provide: DOCUMENT_SEARCH_PROVIDER, useExisting: SearchService },
    { provide: USER_TASK_CREATE_PROVIDER, useExisting: UserTaskService },
  ],
  exports: [ExecutionCoordinatorService],
})
export class ExecutionCoordinatorModule {}

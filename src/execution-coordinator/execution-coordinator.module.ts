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
import { IndexedFileModule } from '../indexed-file/indexed-file.module';
import { ExecutionNextWorkService } from './execution-next-work.service';
import { ExecutionTerminalCandidateService } from './execution-terminal-candidate.service';
import { EXECUTION_NEXT_STEP_SELECTORS } from './execution-next-work.types';
import { ExecutionUnresolvedInferenceSelectorService } from './execution-unresolved-inference-selector.service';

@Module({
  imports: [
    ExecutionModule,
    ExecutionProcessorModule.register(),
    ExecutionOutboxModule,
    SearchModule,
    UserTaskModule,
    IndexedFileModule,
  ],
  providers: [
    ExecutionCoordinatorService,
    ExecutionAgentLoopService,
    ExecutionNextWorkService,
    ExecutionTerminalCandidateService,
    ExecutionUnresolvedInferenceSelectorService,
    ExecutionToolRuntimeService,
    {
      provide: EXECUTION_NEXT_STEP_SELECTORS,
      useFactory: (
        agentLoop: ExecutionAgentLoopService,
        unresolvedInference: ExecutionUnresolvedInferenceSelectorService,
      ) => [agentLoop, unresolvedInference],
      inject: [
        ExecutionAgentLoopService,
        ExecutionUnresolvedInferenceSelectorService,
      ],
    },
    { provide: DOCUMENT_SEARCH_PROVIDER, useExisting: SearchService },
    { provide: USER_TASK_CREATE_PROVIDER, useExisting: UserTaskService },
  ],
  exports: [ExecutionCoordinatorService],
})
export class ExecutionCoordinatorModule {}

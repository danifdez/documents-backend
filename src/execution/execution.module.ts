import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ExecutionController } from './execution.controller';
import { ExecutionService } from './execution.service';
import { ExecutionContractValidator } from './execution-contract-validator';
import { ExecutionStepService } from './execution-step.service';
import { ExecutionAttemptService } from './execution-attempt.service';
import { ExecutionProtocolController } from './execution-protocol.controller';
import { WorkerModule } from '../worker/worker.module';
import { ExecutionToolPlanService } from './execution-tool-plan.service';

@Module({
  imports: [DatabaseModule, WorkerModule],
  controllers: [ExecutionController, ExecutionProtocolController],
  providers: [
    ExecutionService,
    ExecutionContractValidator,
    ExecutionStepService,
    ExecutionAttemptService,
    ExecutionToolPlanService,
  ],
  exports: [
    ExecutionService,
    ExecutionStepService,
    ExecutionAttemptService,
    ExecutionToolPlanService,
  ],
})
export class ExecutionModule {}

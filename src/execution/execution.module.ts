import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ExecutionController } from './execution.controller';
import { ExecutionService } from './execution.service';
import { ExecutionContractValidator } from './execution-contract-validator';
import { ExecutionStepService } from './execution-step.service';
import { ExecutionAttemptService } from './execution-attempt.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ExecutionController],
  providers: [
    ExecutionService,
    ExecutionContractValidator,
    ExecutionStepService,
    ExecutionAttemptService,
  ],
  exports: [ExecutionService, ExecutionStepService, ExecutionAttemptService],
})
export class ExecutionModule {}

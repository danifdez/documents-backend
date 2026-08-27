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
import { ExecutionProgressService } from './execution-progress.service';
import { ExecutionArtifactService } from './execution-artifact.service';
import { ExecutionConfirmationController } from './execution-confirmation.controller';
import { ExecutionConfirmationService } from './execution-confirmation.service';
import { BrowserWorkController } from '../worker/browser-work.controller';
import { ExecutionEffectJournalService } from './execution-effect-journal.service';
import { ExecutionArtifactStorageService } from './execution-artifact-storage.service';
import { ExecutionRetentionService } from './execution-retention.service';

@Module({
  imports: [DatabaseModule, WorkerModule],
  controllers: [
    ExecutionController,
    ExecutionProtocolController,
    ExecutionConfirmationController,
    BrowserWorkController,
  ],
  providers: [
    ExecutionService,
    ExecutionContractValidator,
    ExecutionStepService,
    ExecutionAttemptService,
    ExecutionToolPlanService,
    ExecutionProgressService,
    ExecutionArtifactService,
    ExecutionArtifactStorageService,
    ExecutionConfirmationService,
    ExecutionEffectJournalService,
    ExecutionRetentionService,
  ],
  exports: [
    ExecutionService,
    ExecutionContractValidator,
    ExecutionStepService,
    ExecutionAttemptService,
    ExecutionToolPlanService,
    ExecutionProgressService,
    ExecutionArtifactService,
    ExecutionArtifactStorageService,
    ExecutionConfirmationService,
    ExecutionEffectJournalService,
  ],
})
export class ExecutionModule {}

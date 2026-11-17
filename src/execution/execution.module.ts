import { AuthModule } from '../auth/auth.module';
import { ExecutionStreamService } from './execution-stream.service';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ExecutionController } from './execution.controller';
import { ExecutionService } from './execution.service';
import { ExecutionConversationService } from './execution-conversation.service';
import { ExecutionContractValidator } from './execution-contract-validator';
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
import { ExecutionCompletionValidator } from './execution-completion-validator';

@Module({
  imports: [DatabaseModule, WorkerModule, AuthModule],
  controllers: [
    ExecutionController,
    ExecutionProtocolController,
    ExecutionConfirmationController,
    BrowserWorkController,
  ],
  providers: [
    ExecutionService,
    ExecutionStreamService,
    ExecutionConversationService,
    ExecutionContractValidator,
    ExecutionAttemptService,
    ExecutionToolPlanService,
    ExecutionProgressService,
    ExecutionArtifactService,
    ExecutionArtifactStorageService,
    ExecutionConfirmationService,
    ExecutionEffectJournalService,
    ExecutionRetentionService,
    ExecutionCompletionValidator,
  ],
  exports: [
    ExecutionService,
    ExecutionStreamService,
    ExecutionContractValidator,
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

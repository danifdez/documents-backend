import { claimAvailable } from '../utils/claim-available';
import { Injectable, Logger } from '@nestjs/common';
import { ExecutionProcessorFactory } from '../execution-processor/execution-processor.factory';
import { ExecutionAttemptService } from '../execution/execution-attempt.service';
import { ExecutionStatus } from '../execution/execution-status.enum';
import type { ExecutionEntity } from '../execution/execution.entity';
import { ExecutionService } from '../execution/execution.service';
import { ExecutionOutboxService } from '../execution-outbox/execution-outbox.service';
import { ExecutionToolRuntimeService } from './execution-tool-runtime.service';
import { ExecutionAgentLoopService } from './execution-agent-loop.service';
import { ExecutionConfirmationService } from '../execution/execution-confirmation.service';
import { ExecutionNextWorkService } from './execution-next-work.service';

const TERMINAL_STATUSES = new Set<ExecutionStatus>([
  ExecutionStatus.COMPLETED,
  ExecutionStatus.FAILED,
  ExecutionStatus.CANCELLED,
]);

@Injectable()
export class ExecutionCoordinatorService {
  private readonly logger = new Logger(ExecutionCoordinatorService.name);

  constructor(
    private readonly executionService: ExecutionService,
    private readonly executionAttemptService: ExecutionAttemptService,
    private readonly executionProcessorFactory: ExecutionProcessorFactory,
    private readonly executionOutboxService: ExecutionOutboxService,
    private readonly executionToolRuntime: ExecutionToolRuntimeService,
    private readonly agentLoop: ExecutionAgentLoopService,
    private readonly confirmations: ExecutionConfirmationService,
    private readonly nextWork: ExecutionNextWorkService,
  ) {}

  prepareAgentWork(limit = 20): Promise<number> {
    return this.agentLoop.prepareReadyInferences(limit);
  }

  executeReadyTools(limit = 20): Promise<number> {
    return this.executionToolRuntime.executeReady(limit);
  }

  recoverStaleToolEffects(limit = 20): Promise<number> {
    return this.executionToolRuntime.recoverStaleEffects(limit);
  }

  async acceptResults(limit = 20): Promise<number> {
    const processed =
      await this.executionAttemptService.processReceivedResults(limit);
    await this.nextWork.select(limit);
    await this.executionService.finalizePendingTerminals(limit);
    await this.executionService.reconcileRequestedCancellations(limit);
    return processed;
  }

  publishNotifications(limit = 20): Promise<number> {
    return this.executionOutboxService.publishPending(limit);
  }

  async finalizeReady(limit = 20): Promise<number> {
    let finalized = 0;
    for await (const execution of claimAvailable(
      () => this.executionService.claimReadyForFinalization(),
      limit,
    )) {
      await this.finalizeClaimedExecution(execution);
      finalized += 1;
    }
    await this.nextWork.select(limit);
    await this.executionService.reconcileRequestedCancellations(limit);
    return finalized;
  }

  private async finalizeClaimedExecution(
    execution: ExecutionEntity,
  ): Promise<void> {
    try {
      const processor = this.executionProcessorFactory.getProcessor(
        execution.taskType,
      );
      if (!processor) {
        await this.executionService.markAsFailed(
          execution.executionId,
          `No execution finalizer registered for task type: ${execution.taskType}`,
        );
        return;
      }

      this.logger.log(
        `Finalizing execution ${execution.executionId} of type ${execution.taskType}`,
      );
      const finalizingFailure =
        execution.phase === 'domain_failure_finalization';
      const result = await processor.process(execution);
      if (
        finalizingFailure ||
        (result &&
          typeof result === 'object' &&
          'success' in result &&
          result.success === false)
      ) {
        const previousError = execution.error as Record<string, unknown> | null;
        const message =
          [result.message, result.reason, previousError?.message].find(
            (value): value is string => typeof value === 'string',
          ) ?? `Execution finalizer rejected task type: ${execution.taskType}`;
        await this.executionService.markAsFailed(
          execution.executionId,
          message,
          { publication: result.publication },
        );
        return;
      }

      const current = await this.executionService.findOne(
        execution.executionId,
      );
      if (current && !TERMINAL_STATUSES.has(current.status)) {
        await this.executionService.markAsCompleted(execution.executionId, {
          publication: result.publication,
        });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown finalization error';
      this.logger.error(
        `Error finalizing execution ${execution.executionId}: ${message}`,
      );
      await this.executionService.markAsFailed(execution.executionId, message);
    }
  }

  recoverStaleFinalizations(staleAfterMs: number): Promise<number> {
    return this.executionService.recoverStaleFinalizations(
      new Date(Date.now() - staleAfterMs),
    );
  }

  expireConfirmations(limit = 20): Promise<number> {
    return this.confirmations.expirePending(limit);
  }
}

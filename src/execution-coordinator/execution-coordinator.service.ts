import { Injectable, Logger } from '@nestjs/common';
import { ExecutionProcessorFactory } from '../execution-processor/execution-processor.factory';
import { ExecutionAttemptService } from '../execution/execution-attempt.service';
import { ExecutionStatus } from '../execution/execution-status.enum';
import { ExecutionService } from '../execution/execution.service';
import { ExecutionOutboxService } from '../execution-outbox/execution-outbox.service';
import { ExecutionToolRuntimeService } from './execution-tool-runtime.service';

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
  ) {}

  executeReadyTools(limit = 20): Promise<number> {
    return this.executionToolRuntime.executeReady(limit);
  }

  async acceptResults(limit = 20): Promise<number> {
    const processed =
      await this.executionAttemptService.processReceivedResults(limit);
    await this.executionService.finalizePendingTerminals(limit);
    return processed;
  }

  publishNotifications(limit = 20): Promise<number> {
    return this.executionOutboxService.publishPending(limit);
  }

  async finalizeReady(limit = 20): Promise<number> {
    let finalized = 0;
    while (finalized < limit) {
      const execution = await this.executionService.claimReadyForFinalization();
      if (!execution) break;

      try {
        const processor = this.executionProcessorFactory.getProcessor(
          execution.taskType,
        );
        if (!processor) {
          await this.executionService.markAsFailed(
            execution.executionId,
            `No execution finalizer registered for task type: ${execution.taskType}`,
          );
          finalized += 1;
          continue;
        }

        this.logger.log(
          `Finalizing execution ${execution.executionId} of type ${execution.taskType}`,
        );
        const result = await processor.process(execution);
        if (
          result &&
          typeof result === 'object' &&
          'success' in result &&
          result.success === false
        ) {
          const message =
            typeof result.message === 'string'
              ? result.message
              : typeof result.reason === 'string'
                ? result.reason
                : `Execution finalizer rejected task type: ${execution.taskType}`;
          await this.executionService.markAsFailed(
            execution.executionId,
            message,
            { publication: result.publication },
          );
          finalized += 1;
          continue;
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
        await this.executionService.markAsFailed(
          execution.executionId,
          message,
        );
      }
      finalized += 1;
    }
    return finalized;
  }

  recoverStaleFinalizations(staleAfterMs: number): Promise<number> {
    return this.executionService.recoverStaleFinalizations(
      new Date(Date.now() - staleAfterMs),
    );
  }
}

import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ExecutionService } from './execution.service';
import { ExecutionEntity } from './execution.entity';
import { ExecutionPriority } from './execution-priority.enum';
import { ExecutionStatus } from './execution-status.enum';
import { ExecutionAccessScope } from './execution.types';
import {
  ExecutionTaskPayload,
  ExecutionTaskType,
} from './execution-task-payload.types';
import { canonicalDomainHash } from './execution-canonical';
import { redactExecutionText } from './execution-data-policy';

const terminal = new Set([
  ExecutionStatus.COMPLETED,
  ExecutionStatus.FAILED,
  ExecutionStatus.CANCELLED,
]);

/** Records streaming lifecycles; transport and inference stay in their product. */
@Injectable()
export class ExecutionStreamService {
  constructor(
    private readonly source: DataSource,
    private readonly executions: ExecutionService,
  ) {}

  async open<T extends ExecutionTaskType>(
    taskType: T,
    payload: ExecutionTaskPayload<T>,
    requestId: string,
    scope: ExecutionAccessScope,
    missingEvidence: readonly string[] = [],
  ) {
    const execution = await this.executions.create(
      taskType,
      ExecutionPriority.NORMAL,
      payload,
      {
        requestId,
        ownerPrincipal: scope.ownerPrincipal,
        initialStep: null,
      },
    );
    return this.source.transaction(async (manager) => {
      const repo = manager.getRepository(ExecutionEntity);
      const current = await repo.findOneOrFail({
        where: {
          executionId: execution.executionId,
          ownerPrincipal: scope.ownerPrincipal,
        },
        lock: { mode: 'pessimistic_write' },
      });
      const claimed =
        current.status === ExecutionStatus.QUEUED && current.phase === null;
      if (claimed) {
        current.completenessStatus = missingEvidence.length
          ? 'evaluable_partial'
          : current.completenessStatus;
        current.missingEvidence = [...missingEvidence];
        await repo.save(current);
      }
      const accepted = claimed
        ? await this.executions.updateStatus(
            current.executionId,
            ExecutionStatus.RUNNING,
            undefined,
            { phase: 'stream_accepted' },
            manager,
          )
        : current;
      return {
        executionId: accepted.executionId,
        status: accepted.status,
        result:
          accepted.status === ExecutionStatus.COMPLETED
            ? accepted.result
            : null,
        error:
          accepted.status === ExecutionStatus.FAILED ? accepted.error : null,
        claimed,
      };
    });
  }

  async read(
    requestId: string,
    taskType: ExecutionTaskType,
    scope: ExecutionAccessScope,
  ) {
    const receipt = await this.executions.readRequest(requestId, scope);
    if (!receipt.executionId)
      throw new NotFoundException('Stream execution not found');
    const execution = await this.executions.findOne(receipt.executionId);
    if (execution?.taskType !== taskType)
      throw new NotFoundException('Stream execution not found');
    return receipt;
  }

  async record(
    executionId: string,
    taskType: ExecutionTaskType,
    scope: ExecutionAccessScope,
    status: ExecutionStatus,
    phase: string,
    result?: Record<string, unknown>,
  ) {
    return this.source.transaction(async (manager) => {
      const repo = manager.getRepository(ExecutionEntity);
      const current = await repo.findOne({
        where: {
          executionId,
          rootExecutionId: executionId,
          ownerPrincipal: scope.ownerPrincipal,
          taskType,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!current) throw new NotFoundException('Stream execution not found');
      if (terminal.has(current.status)) {
        if (
          current.status === status &&
          result !== undefined &&
          canonicalDomainHash(current.result) !== canonicalDomainHash(result)
        ) {
          throw new ConflictException(
            'Stream result differs from its terminal record',
          );
        }
        return current;
      }
      if (result !== undefined && !current.cancellationRequestedAt) {
        current.result = result;
        await repo.save(current);
      }
      // Cancellation already requested through the common API wins over output.
      const next = current.cancellationRequestedAt
        ? ExecutionStatus.CANCELLED
        : status;
      return this.executions.updateStatus(
        executionId,
        next,
        next === ExecutionStatus.FAILED
          ? redactExecutionText(phase)
          : undefined,
        { phase, completionReason: phase },
        manager,
      );
    });
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { canonicalJson } from './execution-canonical';
import {
  appendBackendExecutionEvent,
  nextBackendProducerSequence,
} from './execution-event.writer';
import { ExecutionEventEntity } from './execution-event.entity';
import { ExecutionEntity } from './execution.entity';
import {
  exactToolRepeatBlockSignal,
  exactToolRepeatTerminateSignal,
  exactToolRepeatWarningSignal,
} from './exact-tool-repeat-guard';
import {
  assertBucketMatchesOperation,
  assertGrantScope,
  assertOperationBudgetProjection,
  assertReservationMatches,
  assertReservationScope,
  createOperationBudgetGrant,
  createOperationBudgetReservation,
  governedBudgetStart,
  resolveEffectivePolicy,
  validateProgressGrantRequest,
  validateReservationRequest,
  withoutGrantUsage,
} from './inference-budget-policy';
import {
  BudgetSoftLimitSignal,
  ExactToolRepeatGuardState,
  ExactToolRepeatSignal,
  OperationBudgetGrant,
  OperationBudgetReservation,
  OperationBudgetSnapshot,
  ProgressEvent,
  exactToolRepeatGuardSnapshot,
  projectExecutionProgress,
} from './execution-progress';
import {
  OperationBudgetReservationRequest,
  ProgressGrantRequest,
} from './execution.types';

function operationBudgetSnapshot(
  grant: OperationBudgetGrant & {
    usage: {
      normal: OperationBudgetSnapshot['normal'];
      tool: OperationBudgetSnapshot['tool'];
    };
  },
): OperationBudgetSnapshot {
  const normal = structuredClone(grant.usage.normal);
  normal.softLimit ??= 0;
  normal.softLimitReached ??= false;
  normal.softLimitWarningPending ??= false;
  const tool = structuredClone(grant.usage.tool);
  tool.softLimit ??= 0;
  tool.softLimitReached ??= false;
  return { normal, tool };
}

@Injectable()
export class ExecutionProgressService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  async requestProgressGrant(
    rootExecutionId: string,
    request: ProgressGrantRequest,
  ): Promise<{
    grant: OperationBudgetGrant;
    budgetState: OperationBudgetSnapshot;
    guardState: ExactToolRepeatGuardState;
    eventId: string;
  }> {
    validateProgressGrantRequest(rootExecutionId, request);
    return this.dataSource.transaction(async (manager) => {
      const executionRepo = manager.getRepository(ExecutionEntity);
      const eventRepo = manager.getRepository(ExecutionEventEntity);
      const execution = await executionRepo.findOne({
        where: { executionId: rootExecutionId, rootExecutionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!execution) throw new NotFoundException('Execution not found');
      if (execution.cancellationRequestedAt) {
        throw new ConflictException('execution_cancellation_requested');
      }
      assertGrantScope(execution, request);

      const rows = await eventRepo.find({
        where: { rootExecutionId },
        order: { sequence: 'ASC' },
      });
      const progress = projectExecutionProgress(
        rows.map((row) => row.envelope as ProgressEvent),
      );
      const existing = Object.values(
        progress.ledger.operationBudget?.grants ?? {},
      )[0];
      if (existing) {
        const comparableRequest = structuredClone(
          request.requestedPolicy,
        ) as Record<string, unknown>;
        if (existing.requestedPolicy.normalInferenceSoftLimit === undefined) {
          delete comparableRequest.normalInferenceSoftLimit;
        }
        if (existing.requestedPolicy.toolCallSoftLimit === undefined) {
          delete comparableRequest.toolCallSoftLimit;
        }
        if (existing.requestedPolicy.exactToolRepeatWarning === undefined) {
          delete comparableRequest.exactToolRepeatWarning;
        }
        if (
          existing.requestedPolicy.exactToolRepeatBlockAfterWarning ===
          undefined
        ) {
          delete comparableRequest.exactToolRepeatBlockAfterWarning;
        }
        if (
          existing.requestedPolicy.exactToolRepeatTerminateAfterBlock ===
          undefined
        ) {
          delete comparableRequest.exactToolRepeatTerminateAfterBlock;
        }
        if (
          existing.loopId !== request.loopId ||
          canonicalJson(existing.requestedPolicy) !==
            canonicalJson(comparableRequest)
        ) {
          throw new ConflictException(
            'An incompatible progress grant already exists',
          );
        }
        const event = rows.find(
          (row) =>
            (row.envelope.payload as Record<string, any>)?.grant?.grantId ===
            existing.grantId,
        );
        return {
          grant: withoutGrantUsage(existing),
          budgetState: operationBudgetSnapshot(existing),
          guardState: exactToolRepeatGuardSnapshot(
            progress.ledger,
            existing.grantId,
          ),
          eventId: event!.eventId,
        };
      }

      const now = new Date().toISOString();
      const effectivePolicy = resolveEffectivePolicy(request.requestedPolicy, {
        normal: Math.max(
          1,
          this.progressLimit('PROGRESS_CHAT_MAX_NORMAL_INFERENCES', 3),
        ),
        normalInferenceSoftLimit: this.progressLimit(
          'PROGRESS_CHAT_NORMAL_INFERENCE_SOFT_LIMIT',
          2,
        ),
        repair: this.progressLimit('PROGRESS_CHAT_MAX_OUTPUT_REPAIRS', 1),
        closing: this.progressLimit('PROGRESS_CHAT_CLOSING_INFERENCES', 1),
        maxTokensPerInference: Math.max(
          1,
          this.progressLimit('PROGRESS_CHAT_MAX_TOKENS_PER_INFERENCE', 4096),
        ),
        toolCalls: this.progressLimit('PROGRESS_CHAT_MAX_TOOL_CALLS', 6),
        toolCallSoftLimit: this.progressLimit(
          'PROGRESS_CHAT_TOOL_CALL_SOFT_LIMIT',
          4,
        ),
        exactToolRepeatWarning:
          this.progressLimit('PROGRESS_CHAT_EXACT_TOOL_REPEAT_WARNING', 1) > 0,
        exactToolRepeatBlockAfterWarning:
          this.progressLimit(
            'PROGRESS_CHAT_EXACT_TOOL_REPEAT_BLOCK_AFTER_WARNING',
            1,
          ) > 0,
        exactToolRepeatTerminateAfterBlock:
          this.progressLimit(
            'PROGRESS_CHAT_EXACT_TOOL_REPEAT_TERMINATE_AFTER_BLOCK',
            1,
          ) > 0,
      });
      const grant = createOperationBudgetGrant(
        execution,
        request,
        effectivePolicy,
        randomUUID(),
        now,
      );
      const producerSequence = nextBackendProducerSequence(rows);
      const sequence = Number(execution.lastSequence) + 1;
      const event = await appendBackendExecutionEvent(
        manager,
        execution,
        producerSequence,
        {
          eventType: 'progress.reported',
          payloadSchema: 'progress.reported/1',
          payload: {
            message: 'Authoritative operation budget granted',
            kind: 'budget_grant',
            grant,
          },
          actor: { type: 'system' },
          executionId: execution.executionId,
          turnId: execution.turnId,
          causedByEventId: execution.lastEventId,
          artifactRefs: [],
        },
        sequence,
      );
      execution.lastSequence = String(sequence);
      execution.lastEventId = event.eventId;
      const refreshed = await this.refreshProjection(eventRepo, execution);
      await executionRepo.save(execution);
      const projected = refreshed.ledger.operationBudget!.grants[grant.grantId];
      return {
        grant,
        budgetState: operationBudgetSnapshot(projected),
        guardState: exactToolRepeatGuardSnapshot(
          refreshed.ledger,
          grant.grantId,
        ),
        eventId: event.eventId,
      };
    });
  }

  async reserveOperationBudget(
    rootExecutionId: string,
    request: OperationBudgetReservationRequest,
  ): Promise<{
    granted: boolean;
    reservation: OperationBudgetReservation;
    budgetState: OperationBudgetSnapshot;
    softLimitSignal?: BudgetSoftLimitSignal;
    guardState: ExactToolRepeatGuardState;
    loopGuardSignal?: ExactToolRepeatSignal;
    eventId: string;
  }> {
    validateReservationRequest(rootExecutionId, request);
    return this.dataSource.transaction(async (manager) => {
      const executionRepo = manager.getRepository(ExecutionEntity);
      const eventRepo = manager.getRepository(ExecutionEventEntity);
      const execution = await executionRepo.findOne({
        where: { executionId: rootExecutionId, rootExecutionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!execution) throw new NotFoundException('Execution not found');
      if (execution.cancellationRequestedAt) {
        throw new ConflictException('execution_cancellation_requested');
      }
      assertReservationScope(execution, request);

      const rows = await eventRepo.find({
        where: { rootExecutionId },
        order: { sequence: 'ASC' },
      });
      const progress = projectExecutionProgress(
        rows.map((row) => row.envelope as ProgressEvent),
      );
      const existing =
        progress.ledger.operationBudget?.reservations[request.operationId];
      if (existing) {
        assertReservationMatches(existing, request);
        const event = rows.find(
          (row) =>
            (row.envelope.payload as Record<string, any>)?.reservation
              ?.operationId === request.operationId,
        );
        const softLimitEvent = rows.find(
          (row) =>
            (row.envelope.payload as Record<string, any>)?.signal
              ?.triggeringOperationId === request.operationId,
        );
        const softLimitPayload = softLimitEvent?.envelope.payload as
          Record<string, unknown> | undefined;
        const softLimitSignal = softLimitPayload?.signal as
          BudgetSoftLimitSignal | undefined;
        const loopGuardEvent = rows.find(
          (row) =>
            (row.envelope.payload as Record<string, any>)?.loopGuardSignal
              ?.triggeringOperationId === request.operationId,
        );
        const loopGuardPayload = loopGuardEvent?.envelope.payload as
          Record<string, unknown> | undefined;
        const loopGuardSignal = loopGuardPayload?.loopGuardSignal as
          ExactToolRepeatSignal | undefined;
        const existingGrant =
          progress.ledger.operationBudget!.grants[existing.grantId];
        const granted = existing.status === 'reserved';
        return {
          granted,
          reservation:
            existing.status === 'consumed'
              ? {
                  ...existing,
                  reason: 'budget_reservation_consumed',
                }
              : existing,
          budgetState: operationBudgetSnapshot(existingGrant),
          ...(softLimitSignal ? { softLimitSignal } : {}),
          guardState: exactToolRepeatGuardSnapshot(
            progress.ledger,
            existing.grantId,
          ),
          ...(loopGuardSignal ? { loopGuardSignal } : {}),
          eventId:
            loopGuardEvent?.eventId ??
            softLimitEvent?.eventId ??
            event!.eventId,
        };
      }
      const grant = progress.ledger.operationBudget?.grants[request.grantId];
      if (!grant || grant.loopId !== request.loopId) {
        throw new BadRequestException('Unknown operation budget grant');
      }
      if (
        request.operationKind === 'tool_call' &&
        grant.effectivePolicy.exactToolRepeatTerminateAfterBlock === true &&
        (request.toolBatchSize === undefined ||
          request.toolBatchIndex === undefined)
      ) {
        throw new BadRequestException(
          'Tool batch identity is required by the active loop guard policy',
        );
      }
      assertBucketMatchesOperation(
        request.operationKind,
        request.bucket,
        request.phase,
      );
      const usage = grant.usage[request.bucket];
      const hasBudget = usage.available > 0;
      const guardBefore = exactToolRepeatGuardSnapshot(
        progress.ledger,
        grant.grantId,
      );
      const terminateSignal =
        hasBudget &&
        grant.effectivePolicy.exactToolRepeatTerminateAfterBlock === true
          ? exactToolRepeatTerminateSignal(rows, request, guardBefore)
          : undefined;
      const blockSignal =
        hasBudget &&
        !terminateSignal &&
        grant.effectivePolicy.exactToolRepeatBlockAfterWarning === true
          ? exactToolRepeatBlockSignal(rows, request, guardBefore)
          : undefined;
      const granted = hasBudget && !terminateSignal && !blockSignal;
      const committed = usage.reserved + usage.consumed + (granted ? 1 : 0);
      const crossesSoftLimit =
        granted &&
        ((request.operationKind === 'tool_call' && request.bucket === 'tool') ||
          (request.operationKind === 'inference' &&
            request.bucket === 'normal')) &&
        Number(usage.softLimit ?? 0) > 0 &&
        !usage.softLimitReached &&
        committed >= Number(usage.softLimit);
      const warningSignal =
        granted && grant.effectivePolicy.exactToolRepeatWarning === true
          ? exactToolRepeatWarningSignal(rows, request, guardBefore)
          : undefined;
      const loopGuardSignal = terminateSignal ?? blockSignal ?? warningSignal;
      const reservation = createOperationBudgetReservation(
        request,
        granted,
        randomUUID(),
        new Date().toISOString(),
        terminateSignal
          ? 'immediate_exact_tool_repeat_terminated'
          : blockSignal
            ? 'immediate_exact_tool_repeat_blocked'
            : undefined,
      );
      let producerSequence = nextBackendProducerSequence(rows);
      let sequence = Number(execution.lastSequence) + 1;
      const event = await appendBackendExecutionEvent(
        manager,
        execution,
        producerSequence,
        {
          eventType: 'progress.reported',
          payloadSchema: 'progress.reported/1',
          payload: {
            message: granted
              ? 'Operation budget reserved'
              : loopGuardSignal
                ? terminateSignal
                  ? 'Execution terminated by loop guard'
                  : 'Operation blocked by loop guard'
                : 'Operation budget reservation denied',
            kind: 'budget_reservation',
            reservation,
          },
          actor: { type: 'system' },
          executionId: execution.executionId,
          turnId: execution.turnId,
          causedByEventId: execution.lastEventId,
          artifactRefs: [],
        },
        sequence,
      );
      let lastEventId = event.eventId;
      let softLimitSignal: BudgetSoftLimitSignal | undefined;
      if (crossesSoftLimit) {
        softLimitSignal = {
          version: '1',
          grantId: grant.grantId,
          operationKind: request.operationKind,
          bucket: request.bucket as 'normal' | 'tool',
          softLimit: Number(usage.softLimit),
          hardLimit: usage.granted,
          committed,
          available: Math.max(0, usage.granted - committed),
          triggeringOperationId: request.operationId,
          decidedAt: new Date().toISOString(),
        };
        const signalEvent = await appendBackendExecutionEvent(
          manager,
          execution,
          ++producerSequence,
          {
            eventType: 'progress.reported',
            payloadSchema: 'progress.reported/1',
            payload: {
              message:
                request.operationKind === 'tool_call'
                  ? 'Tool budget soft limit reached'
                  : 'Normal inference budget soft limit reached',
              kind: 'budget_soft_limit_reached',
              signal: softLimitSignal,
            },
            actor: { type: 'system' },
            executionId: execution.executionId,
            turnId: execution.turnId,
            causedByEventId: event.eventId,
            artifactRefs: [],
          },
          ++sequence,
        );
        lastEventId = signalEvent.eventId;
      }
      if (loopGuardSignal) {
        const signalEvent = await appendBackendExecutionEvent(
          manager,
          execution,
          ++producerSequence,
          {
            eventType: 'progress.reported',
            payloadSchema: 'progress.reported/1',
            payload: {
              message:
                loopGuardSignal.action === 'terminate'
                  ? 'Immediate exact tool repeat persisted'
                  : loopGuardSignal.action === 'block'
                    ? 'Immediate exact tool repeat blocked'
                    : 'Immediate exact tool repeat detected',
              kind: 'loop_guard_triggered',
              loopGuardSignal,
            },
            actor: { type: 'system' },
            executionId: execution.executionId,
            turnId: execution.turnId,
            causedByEventId: event.eventId,
            artifactRefs: [],
          },
          ++sequence,
        );
        lastEventId = signalEvent.eventId;
      }
      execution.lastSequence = String(sequence);
      execution.lastEventId = lastEventId;
      const refreshed = await this.refreshProjection(eventRepo, execution);
      await executionRepo.save(execution);
      const projected = refreshed.ledger.operationBudget!.grants[grant.grantId];
      return {
        granted,
        reservation,
        budgetState: operationBudgetSnapshot(projected),
        ...(softLimitSignal ? { softLimitSignal } : {}),
        guardState: exactToolRepeatGuardSnapshot(
          refreshed.ledger,
          grant.grantId,
        ),
        ...(loopGuardSignal ? { loopGuardSignal } : {}),
        eventId: lastEventId,
      };
    });
  }

  async refreshProjection(
    eventRepo: Repository<ExecutionEventEntity>,
    execution: ExecutionEntity,
  ) {
    const rows = await eventRepo.find({
      where: { rootExecutionId: execution.rootExecutionId },
      order: { sequence: 'ASC' },
    });
    const progress = projectExecutionProgress(
      rows.map((row) => row.envelope as ProgressEvent),
    );
    execution.progressPolicy = progress.policy;
    execution.progressLedger = progress.ledger;
    return progress;
  }

  async validateOperationStart(
    eventRepo: Repository<ExecutionEventEntity>,
    execution: ExecutionEntity,
    event: Record<string, unknown>,
  ): Promise<void> {
    const identity = governedBudgetStart(execution, event);
    if (!identity) return;
    const rows = await eventRepo.find({
      where: { rootExecutionId: execution.rootExecutionId },
      order: { sequence: 'ASC' },
    });
    const progress = projectExecutionProgress(
      rows.map((row) => row.envelope as ProgressEvent),
    );
    assertOperationBudgetProjection(
      identity,
      progress.ledger.operationBudget,
      exactToolRepeatGuardSnapshot(progress.ledger, identity.grantId),
    );
  }

  private progressLimit(name: string, fallback: number): number {
    const value = Number(this.config.get<string>(name) ?? fallback);
    return Number.isInteger(value) && value >= 0 ? value : fallback;
  }
}

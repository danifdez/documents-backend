import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager, In } from 'typeorm';
import { canonicalHash, contentHash } from '../execution/execution-canonical';
import { ExecutionArtifactEntity } from '../execution/execution-artifact.entity';
import { ExecutionEventEntity } from '../execution/execution-event.entity';
import {
  appendBackendExecutionEvent,
  nextBackendProducerSequence,
} from '../execution/execution-event.writer';
import { ExecutionOperationEntity } from '../execution/execution-operation.entity';
import { ExecutionOperationStatus } from '../execution/execution-operation-status.enum';
import { ExecutionResultReceiptEntity } from '../execution/execution-result-receipt.entity';
import { ExecutionStepEntity } from '../execution/execution-step.entity';
import { createExecutionStep } from '../execution/execution-step.service';
import { ExecutionStepKind } from '../execution/execution-step-kind.enum';
import { ExecutionStepStatus } from '../execution/execution-step-status.enum';
import { ExecutionToolPlanEntity } from '../execution/execution-tool-plan.entity';
import { ExecutionToolPlanService } from '../execution/execution-tool-plan.service';
import { ToolResultContract } from '../execution/execution-tool.types';
import { ExecutionEntity } from '../execution/execution.entity';
import { ExecutionProgressService } from '../execution/execution-progress.service';
import { DeterministicPartialResult } from '../execution/execution.types';
import {
  ChatExecutionPayload,
  executionTaskWork,
} from '../execution/execution-task-payload.types';
import { COORDINATION_PENDING_PHASE } from '../execution/execution.constants';
import {
  ACTIVE_CONTEXT_ARTIFACT_ROLE,
  freezeActiveContextArtifact,
} from '../conversation/conversation-context';
import {
  AgentInferenceCoordination,
  AgentLoopContinuation,
  ExecutionNextStepSelector,
  RuntimeDirective,
} from './execution-next-work.types';

const CHAT_TASK_TYPES = ['assistant-chat', 'agent-chat', 'delegated-agent'];
const TOOL_LOOP_TASK_TYPES = ['assistant-chat', 'agent-chat'];
const DEFAULT_POLICY = {
  normal: 3,
  normalInferenceSoftLimit: 2,
  repair: 1,
  closing: 1,
  maxTokensPerInference: 4096,
  toolCalls: 6,
  toolCallSoftLimit: 4,
  exactToolRepeatWarning: true,
  exactToolRepeatBlockAfterWarning: true,
  exactToolRepeatTerminateAfterBlock: true,
};

type ToolRequest = {
  toolCallId: string;
  name: string;
  arguments: Record<string, unknown>;
};

type ToolRound = {
  round: number;
  calls: ToolRequest[];
  results: ToolResultContract[];
};

@Injectable()
export class ExecutionAgentLoopService implements ExecutionNextStepSelector {
  readonly selectorId = 'agent-loop';
  private readonly logger = new Logger(ExecutionAgentLoopService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly progress: ExecutionProgressService,
    private readonly toolPlans: ExecutionToolPlanService,
  ) {}

  async selectNextWork(limit = 20): Promise<number> {
    let materialized = await this.materializeAcceptedToolRequests(limit);
    if (materialized < limit) {
      materialized += await this.materializeInvalidOutcomes(
        limit - materialized,
      );
    }
    if (materialized < limit) {
      materialized += await this.materializeReadyToolContinuations(
        limit - materialized,
      );
    }
    if (materialized < limit) {
      materialized += await this.releaseTerminalDelegations(
        limit - materialized,
      );
    }
    return materialized;
  }

  async prepareReadyInferences(limit = 20): Promise<number> {
    let prepared = 0;
    while (prepared < limit) {
      const rows = await this.dataSource.query(
        `
          SELECT step."step_id"
          FROM "execution_steps" step
          INNER JOIN "executions" execution
            ON execution."execution_id" = step."execution_id"
          WHERE step."status" = 'ready'
            AND step."step_kind" = 'inference'
            AND step."budget_reservation_id" IS NULL
            AND step."work" ->> 'taskType' = ANY($1::text[])
            AND execution."task_type" = ANY($1::text[])
            AND execution."status" IN ('queued', 'running')
            AND execution."cancellation_requested_at" IS NULL
          ORDER BY step."priority" DESC, step."available_at", step."created_at"
          LIMIT 1
        `,
        [CHAT_TASK_TYPES],
      );
      if (!rows.length) break;
      const changed = await this.prepareInference(String(rows[0].step_id));
      if (!changed) continue;
      prepared += 1;
    }
    return prepared;
  }

  async materializeAcceptedToolRequests(limit = 20): Promise<number> {
    const rows = await this.dataSource.query(
      `
        SELECT step."step_id"
        FROM "execution_steps" step
        INNER JOIN "execution_result_receipts" receipt
          ON receipt."attempt_id" = step."current_attempt_id"
        INNER JOIN "executions" execution
          ON execution."execution_id" = step."execution_id"
        WHERE step."status" = 'completed'
          AND step."step_kind" = 'inference'
          AND step."continuation_processed_at" IS NULL
          AND receipt."result" #>> '{output,outcome,kind}' = 'tool_requests'
          AND execution."task_type" = ANY($2::text[])
          AND execution."status" IN ('queued', 'running')
          AND execution."cancellation_requested_at" IS NULL
          AND execution."phase" = $3
        ORDER BY receipt."received_at"
        LIMIT $1
      `,
      [limit, TOOL_LOOP_TASK_TYPES, COORDINATION_PENDING_PHASE],
    );
    let materialized = 0;
    for (const row of rows) {
      materialized += await this.materializeToolBatch(String(row.step_id));
    }
    return materialized;
  }

  async materializeReadyToolContinuations(limit = 20): Promise<number> {
    const rows = await this.dataSource.query(
      `
        SELECT step."step_id"
        FROM "execution_steps" step
        INNER JOIN "executions" execution
          ON execution."execution_id" = step."execution_id"
        WHERE step."status" = 'completed'
          AND step."step_kind" = 'inference'
          AND step."continuation_processed_at" IS NOT NULL
          AND step."continuation_step_id" IS NULL
          AND step."result" #>> '{outcome,kind}' = 'tool_requests'
          AND execution."task_type" = ANY($2::text[])
          AND execution."status" IN ('queued', 'running')
          AND execution."cancellation_requested_at" IS NULL
          AND execution."phase" = $3
        ORDER BY step."updated_at"
        LIMIT $1
      `,
      [limit, TOOL_LOOP_TASK_TYPES, COORDINATION_PENDING_PHASE],
    );
    let materialized = 0;
    for (const row of rows) {
      if (await this.materializeToolContinuation(String(row.step_id))) {
        materialized += 1;
      }
    }
    return materialized;
  }

  async materializeInvalidOutcomes(limit = 20): Promise<number> {
    const rows = await this.dataSource.query(
      `
        SELECT step."step_id"
        FROM "execution_steps" step
        INNER JOIN "executions" execution
          ON execution."execution_id" = step."execution_id"
        WHERE step."status" = 'completed'
          AND step."step_kind" = 'inference'
          AND step."continuation_processed_at" IS NULL
          AND step."result" #>> '{outcome,kind}' = 'invalid'
          AND execution."task_type" = ANY($2::text[])
          AND execution."status" IN ('queued', 'running')
          AND execution."cancellation_requested_at" IS NULL
          AND execution."phase" = $3
        ORDER BY step."updated_at"
        LIMIT $1
      `,
      [limit, CHAT_TASK_TYPES, COORDINATION_PENDING_PHASE],
    );
    let materialized = 0;
    for (const row of rows) {
      if (await this.materializeInvalidOutcome(String(row.step_id))) {
        materialized += 1;
      }
    }
    return materialized;
  }

  async releaseTerminalDelegations(limit = 20): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const [releasedRows] = (await manager.query(
        `
          WITH candidates AS (
            SELECT step."step_id"
            FROM "execution_steps" step
            INNER JOIN "executions" parent
              ON parent."execution_id" = step."execution_id"
            INNER JOIN "executions" child
              ON child."execution_id"::text = step."work" ->> 'childExecutionId'
            WHERE step."status" = 'blocked'
              AND step."step_kind" = 'tool'
              AND step."work" ->> 'taskType' = 'agents.delegate'
              AND child."root_execution_id" = parent."root_execution_id"
              AND child."parent_execution_id" = parent."execution_id"
              AND child."payload" ->> 'delegationOperationId' =
                  step."operation_id"::text
              AND child."status" IN ('completed', 'failed', 'cancelled')
            ORDER BY step."created_at"
            LIMIT $1
            FOR UPDATE OF step SKIP LOCKED
          )
          UPDATE "execution_steps" step
          SET "status" = 'ready',
              "version" = "version" + 1,
              "updated_at" = now()
          FROM candidates
          WHERE step."step_id" = candidates."step_id"
          RETURNING step."operation_id"
        `,
        [limit],
      )) as [{ operation_id: string }[], number];
      const operationIds = releasedRows.map(
        (row: { operation_id: string }) => row.operation_id,
      );
      if (!operationIds.length) return 0;
      await manager.query(
        `
          UPDATE "execution_operations"
          SET "status" = 'prepared', "updated_at" = now()
          WHERE "operation_id" = ANY($1::uuid[])
            AND "status" = 'planned'
        `,
        [operationIds],
      );
      return operationIds.length;
    });
  }

  private async prepareInference(stepId: string): Promise<boolean> {
    const step = await this.dataSource
      .getRepository(ExecutionStepEntity)
      .findOneBy({ stepId });
    if (!step || step.budgetReservationId) return false;
    const execution = await this.dataSource
      .getRepository(ExecutionEntity)
      .findOneByOrFail({ executionId: step.executionId });
    const root = await this.dataSource
      .getRepository(ExecutionEntity)
      .findOneByOrFail({ executionId: execution.rootExecutionId });
    const grant =
      execution.executionId === execution.rootExecutionId
        ? (
            await this.progress.requestProgressGrant(root.executionId, {
              executionId: root.executionId,
              turnId: root.turnId!,
              loopId: root.executionId,
              agentName:
                execution.taskType === 'agent-chat' ? 'agent' : 'assistant',
              loopKind: 'top_level',
              requestedPolicy: DEFAULT_POLICY,
            })
          ).grant
        : Object.values(root.progressLedger?.operationBudget?.grants ?? {})[0];
    if (!grant) throw new ConflictException('root_budget_grant_missing');
    const refreshed = await this.dataSource
      .getRepository(ExecutionEntity)
      .findOneByOrFail({ executionId: root.executionId });
    const existingReservation =
      refreshed.progressLedger?.operationBudget?.reservations[step.operationId];
    const round =
      existingReservation?.round ?? this.nextInferenceRound(refreshed);
    const coordination = this.inferenceCoordination(step);
    const bucket =
      coordination.purpose === 'repair'
        ? 'repair'
        : coordination.purpose === 'closing'
          ? 'closing'
          : 'normal';
    const decision = await this.progress.reserveOperationBudget(
      root.executionId,
      {
        executionId: root.executionId,
        loopId: root.executionId,
        grantId: grant.grantId,
        operationId: step.operationId,
        operationKind: 'inference',
        bucket,
        phase: coordination.phase,
        round,
        name:
          coordination.purpose === 'repair'
            ? 'output_repair'
            : coordination.purpose === 'closing'
              ? 'forced_finalization'
              : execution.taskType === 'delegated-agent'
                ? 'delegated-agent'
                : String(step.work.taskType ?? execution.taskType),
      },
    );
    if (!decision.granted) {
      return this.handleDeniedInference(
        step,
        execution,
        grant.grantId,
        decision.eventId,
        coordination,
      );
    }
    return this.dataSource.transaction(async (manager) => {
      const locked = await manager.getRepository(ExecutionStepEntity).findOne({
        where: { stepId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked || locked.budgetReservationId) return false;
      if (locked.status !== ExecutionStepStatus.READY) {
        throw new ConflictException('inference_step_not_ready');
      }
      if (decision.softLimitSignal) {
        const directive: RuntimeDirective = {
          schemaVersion: 'runtime-directive/1',
          kind: 'progress_warning',
          reason: 'normal_budget_soft_limit',
          toolsAllowed: true,
        };
        const payload = this.payloadWithDirective(
          this.stepPayload(locked),
          directive,
        );
        const retainedRefs = locked.inputArtifactRefs.filter(
          (ref) => ref.role !== ACTIVE_CONTEXT_ARTIFACT_ROLE,
        );
        const contextArtifact = await freezeActiveContextArtifact(manager, {
          rootExecutionId: execution.rootExecutionId,
          sessionId: execution.sessionId,
          turnId: execution.turnId,
          causedByEventId: decision.eventId,
          effectivePayload: payload,
          derivedFromArtifactIds: retainedRefs.map((ref) => ref.artifactId),
        });
        locked.inputArtifactRefs = [
          ...retainedRefs,
          {
            role: ACTIVE_CONTEXT_ARTIFACT_ROLE,
            artifactId: contextArtifact.artifactId,
          },
        ];
        locked.work = { ...locked.work, payload };
      }
      locked.budgetReservationId = decision.reservation.reservationId;
      await manager.save(locked);
      return true;
    });
  }

  private inferenceCoordination(
    step: ExecutionStepEntity,
  ): AgentInferenceCoordination {
    const value = step.work.agentLoop;
    if (!value || typeof value !== 'object') {
      throw new ConflictException('agent_inference_coordination_missing');
    }
    const coordination = value as AgentInferenceCoordination;
    if (
      coordination.schemaVersion !== 'agent-inference/1' ||
      !['normal', 'repair', 'closing'].includes(coordination.purpose) ||
      !['agent_loop', 'output_repair', 'forced_finalization'].includes(
        coordination.phase,
      ) ||
      !Array.isArray(coordination.evidenceStepIds)
    ) {
      throw new ConflictException('agent_inference_coordination_invalid');
    }
    return coordination;
  }

  private nextInferenceRound(execution: ExecutionEntity): number {
    const reservations = Object.values(
      execution.progressLedger?.operationBudget?.reservations ?? {},
    ).filter((reservation) => reservation.operationKind === 'inference');
    return Math.max(0, ...reservations.map((item) => item.round)) + 1;
  }

  private async materializeToolBatch(stepId: string): Promise<number> {
    const step = await this.dataSource
      .getRepository(ExecutionStepEntity)
      .findOneByOrFail({ stepId });
    if (!step.currentAttemptId) {
      throw new ConflictException('tool_request_attempt_missing');
    }
    const receipt = await this.dataSource
      .getRepository(ExecutionResultReceiptEntity)
      .findOneOrFail({
        where: { attemptId: step.currentAttemptId },
        order: { receivedAt: 'DESC' },
      });
    const result = receipt.result as Record<string, unknown>;
    const output = result.output as Record<string, unknown>;
    const outcome = output.outcome as Record<string, unknown>;
    const calls = outcome.calls as ToolRequest[];
    const execution = await this.dataSource
      .getRepository(ExecutionEntity)
      .findOneByOrFail({ executionId: step.executionId });
    const sourceReservation =
      execution.progressLedger?.operationBudget?.reservations[step.operationId];
    if (!sourceReservation || sourceReservation.status !== 'consumed') {
      throw new ConflictException('tool_request_source_budget_missing');
    }
    const finish = await this.dataSource
      .getRepository(ExecutionEventEntity)
      .findOneByOrFail({
        rootExecutionId: execution.rootExecutionId,
        operationId: step.operationId,
        attemptId: step.currentAttemptId,
        eventType: 'operation.finished',
      });
    let materialized = 0;
    const preparedBatch: Array<{
      call: ToolRequest;
      plan: ExecutionToolPlanEntity;
      reservationId: string;
    }> = [];
    const deniedBatch: Array<{
      plan: ExecutionToolPlanEntity;
      error: { code: string; message: string };
      continuation?: AgentLoopContinuation;
    }> = [];
    let confirmationPending = false;
    let continuation: AgentLoopContinuation = { kind: 'normal' };
    for (const [index, call] of calls.entries()) {
      try {
        const prepared = await this.toolPlans.prepare({
          schemaVersion: 'tool-invocation/1',
          toolCallId: call.toolCallId,
          name: call.name,
          arguments: call.arguments,
          requester: {
            kind: 'model',
            operationId: step.operationId,
            attemptId: step.currentAttemptId,
          },
          executionContext: {
            executionId: execution.executionId,
            ...(execution.turnId ? { turnId: execution.turnId } : {}),
            causedByEventId: finish.eventId,
            phase: 'agent_loop',
            dataClassification: 'workspace',
          },
        });
        const disposition = await this.toolPlans.getMaterializationDisposition(
          call.toolCallId,
        );
        if (disposition.kind === 'waiting_confirmation') {
          confirmationPending = true;
          continue;
        }
        if (disposition.kind === 'not_executed') {
          deniedBatch.push({
            plan: prepared.plan,
            error: disposition.error,
          });
          continue;
        }
        const decision = await this.progress.reserveOperationBudget(
          execution.executionId,
          {
            executionId: execution.executionId,
            loopId: execution.executionId,
            grantId: sourceReservation.grantId,
            operationId: prepared.plan.operationId,
            operationKind: 'tool_call',
            bucket: 'tool',
            toolCallId: call.toolCallId,
            operationFingerprint: canonicalHash({
              name: call.name,
              arguments: call.arguments,
            }),
            operationFingerprintVersion: 'canonical_tool_input_v1',
            toolBatchSize: calls.length,
            toolBatchIndex: index,
            phase: 'agent_loop',
            round: sourceReservation.round,
            name: call.name,
          },
        );
        if (!decision.granted) {
          const action = decision.loopGuardSignal?.action;
          deniedBatch.push({
            plan: prepared.plan,
            error: {
              code:
                action === 'terminate'
                  ? 'loop_guard_terminated'
                  : action === 'block'
                    ? 'loop_guard_blocked'
                    : 'tool_budget_exhausted',
              message:
                action === 'terminate'
                  ? 'The repeated tool operation was not executed because the loop guard terminated the loop'
                  : action === 'block'
                    ? 'The repeated tool operation was not executed because the loop guard blocked it'
                    : 'The tool operation was not executed because the tool budget was exhausted',
            },
            continuation:
              action === 'terminate'
                ? {
                    kind: 'partial',
                    trigger: 'exact_tool_repeat_persisted',
                  }
                : action === 'block'
                  ? {
                      kind: 'normal',
                      directive: 'exact_tool_repeat_blocked',
                    }
                  : { kind: 'closing', reason: 'tool_budget_exhausted' },
          });
          continue;
        }
        if (
          continuation.kind === 'normal' &&
          decision.loopGuardSignal?.action === 'warn'
        ) {
          continuation = {
            kind: 'normal',
            directive: 'exact_tool_repeat_warning',
          };
        } else if (
          continuation.kind === 'normal' &&
          !continuation.directive &&
          decision.softLimitSignal
        ) {
          continuation = {
            kind: 'normal',
            directive: 'tool_budget_soft_limit',
          };
        }
        preparedBatch.push({
          call,
          plan: prepared.plan,
          reservationId: decision.reservation.reservationId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Failed to materialize tool request ${call.toolCallId}: ${message}`,
        );
        throw error;
      }
    }
    for (const item of deniedBatch) {
      const alreadyMaterialized = item.plan.stepId !== null;
      await this.toolPlans.materializeNotExecuted(
        item.plan.toolCallId,
        item.error,
      );
      if (!alreadyMaterialized) materialized += 1;
      if (item.continuation?.kind === 'partial') {
        continuation = item.continuation;
      } else if (
        item.continuation?.kind === 'closing' &&
        continuation.kind !== 'partial'
      ) {
        continuation = item.continuation;
      } else if (
        item.continuation?.kind === 'normal' &&
        continuation.kind === 'normal'
      ) {
        continuation = item.continuation;
      }
    }
    for (const item of preparedBatch) {
      const alreadyMaterialized = item.plan.stepId !== null;
      const step = await this.toolPlans.materialize(
        item.call.toolCallId,
        item.reservationId,
      );
      if (!step) {
        confirmationPending = true;
      } else if (!alreadyMaterialized) {
        materialized += 1;
      }
    }
    if (confirmationPending) {
      await this.toolPlans.activatePendingConfirmations(execution.executionId);
      return materialized;
    }
    await this.dataSource.transaction(async (manager) => {
      const locked = await manager.getRepository(ExecutionStepEntity).findOne({
        where: { stepId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) throw new ConflictException('tool_request_step_missing');
      locked.continuationProcessedAt = new Date();
      locked.work = {
        ...locked.work,
        agentLoopContinuation: continuation,
      };
      await manager.save(locked);
    });
    return materialized;
  }

  private async materializeToolContinuation(stepId: string): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const stepRepo = manager.getRepository(ExecutionStepEntity);
      const source = await stepRepo.findOne({
        where: { stepId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!source || source.continuationStepId) return false;

      const outcome = (source.result as Record<string, unknown> | null)
        ?.outcome as Record<string, unknown> | undefined;
      const calls = outcome?.calls as ToolRequest[] | undefined;
      if (!Array.isArray(calls) || !calls.length) {
        throw new ConflictException('invalid_tool_request_outcome');
      }
      const plans = await manager.getRepository(ExecutionToolPlanEntity).find({
        where: { toolCallId: In(calls.map((call) => call.toolCallId)) },
      });
      const planByCall = new Map(plans.map((plan) => [plan.toolCallId, plan]));
      const toolStepIds = calls.map(
        (call) => planByCall.get(call.toolCallId)?.stepId ?? null,
      );
      if (toolStepIds.some((toolStepId) => !toolStepId)) return false;

      const toolSteps = await stepRepo.find({
        where: { stepId: In(toolStepIds as string[]) },
      });
      const toolStepById = new Map(
        toolSteps.map((toolStep) => [toolStep.stepId, toolStep]),
      );
      const orderedToolSteps = (toolStepIds as string[]).map((toolStepId) =>
        toolStepById.get(toolStepId),
      );
      if (
        orderedToolSteps.some(
          (toolStep) => toolStep?.status !== ExecutionStepStatus.COMPLETED,
        )
      ) {
        return false;
      }

      const results = orderedToolSteps.map((toolStep) => {
        const output = toolStep!.result as Record<string, unknown> | null;
        const result = output?.toolResult as ToolResultContract | undefined;
        if (!result) throw new ConflictException('tool_result_missing');
        return result;
      });
      const continuationArtifacts = [
        ...source.inputArtifactRefs,
        ...orderedToolSteps.flatMap(
          (toolStep) => toolStep?.outputArtifactRefs ?? [],
        ),
      ]
        .filter((ref) => ref.role !== ACTIVE_CONTEXT_ARTIFACT_ROLE)
        .filter(
          (ref, index, refs) =>
            refs.findIndex(
              (candidate) => candidate.artifactId === ref.artifactId,
            ) === index,
        );
      const execution = await manager.getRepository(ExecutionEntity).findOne({
        where: { executionId: source.executionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!execution) throw new ConflictException('execution_not_found');
      const sourceReservation =
        execution.progressLedger?.operationBudget?.reservations[
          source.operationId
        ];
      if (!sourceReservation) {
        throw new ConflictException('tool_request_source_budget_missing');
      }
      const finish = await manager.getRepository(ExecutionEventEntity).findOne({
        where: {
          rootExecutionId: execution.rootExecutionId,
          operationId: In(
            orderedToolSteps.map((toolStep) => toolStep!.operationId),
          ),
          eventType: 'operation.finished',
        },
        order: { sequence: 'DESC' },
      });
      const causedByEventId = finish?.eventId ?? execution.lastEventId;
      if (!causedByEventId) {
        throw new ConflictException('tool_batch_finish_missing');
      }

      const work = source.work ?? {};
      const payload =
        work.payload && typeof work.payload === 'object'
          ? (work.payload as Record<string, unknown>)
          : {};
      const history = Array.isArray(payload.toolHistory)
        ? (payload.toolHistory as ToolRound[])
        : [];
      let effectivePayload: ChatExecutionPayload = {
        ...payload,
        toolHistory: [
          ...history,
          { round: sourceReservation.round, calls, results },
        ],
      };
      const requested = this.continuationDirective(source);
      if (requested.kind === 'partial') {
        source.work = {
          ...source.work,
          agentLoopTerminalPrepared: true,
        };
        await stepRepo.save(source);
        await this.materializeDeterministicPartial(
          manager,
          execution,
          requested.trigger,
          causedByEventId,
        );
        return true;
      }
      const purpose = requested.kind === 'closing' ? 'closing' : 'normal';
      const directive =
        requested.kind === 'closing'
          ? this.forcedFinalizationDirective(requested.reason)
          : requested.directive
            ? {
                schemaVersion: 'runtime-directive/1' as const,
                kind: 'progress_warning' as const,
                reason: requested.directive,
                toolsAllowed: true as const,
              }
            : null;
      if (directive) {
        effectivePayload = this.payloadWithDirective(
          effectivePayload,
          directive,
        );
      }
      const continuation = await this.createInferenceContinuation(manager, {
        execution,
        source,
        purpose,
        payload: effectivePayload,
        evidenceStepIds: toolStepIds as string[],
        inputArtifactRefs: continuationArtifacts,
        causedByEventId,
      });
      source.continuationStepId = continuation.stepId;
      await stepRepo.save(source);
      return true;
    });
  }

  private async materializeInvalidOutcome(stepId: string): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const stepRepo = manager.getRepository(ExecutionStepEntity);
      const source = await stepRepo.findOne({
        where: { stepId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!source || source.continuationProcessedAt) return false;
      const outcome = (source.result as Record<string, unknown> | null)
        ?.outcome as Record<string, unknown> | undefined;
      if (outcome?.kind !== 'invalid') return false;
      const execution = await manager.getRepository(ExecutionEntity).findOne({
        where: { executionId: source.executionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!execution) throw new ConflictException('execution_not_found');
      const finish = await manager.getRepository(ExecutionEventEntity).findOne({
        where: {
          rootExecutionId: execution.rootExecutionId,
          operationId: source.operationId,
          eventType: 'operation.finished',
        },
        order: { sequence: 'DESC' },
      });
      const causedByEventId = finish?.eventId ?? execution.lastEventId;
      if (!causedByEventId) {
        throw new ConflictException('invalid_outcome_finish_missing');
      }
      source.continuationProcessedAt = new Date();
      const coordination = this.inferenceCoordination(source);
      if (coordination.purpose === 'closing') {
        source.work = {
          ...source.work,
          agentLoopTerminalPrepared: true,
        };
        await stepRepo.save(source);
        await this.materializeDeterministicPartial(
          manager,
          execution,
          'closing_output_empty',
          causedByEventId,
        );
        return true;
      }

      const purpose = coordination.purpose === 'repair' ? 'closing' : 'repair';
      const reason = String(outcome.reason ?? 'invalid_model_output');
      const directive: RuntimeDirective =
        purpose === 'repair'
          ? {
              schemaVersion: 'runtime-directive/1',
              kind: 'output_repair',
              reason,
              toolsAllowed: false,
            }
          : this.forcedFinalizationDirective('budget_exhausted');
      const payload = this.payloadWithDirective(
        this.stepPayload(source),
        directive,
      );
      const continuation = await this.createInferenceContinuation(manager, {
        execution,
        source,
        purpose,
        payload,
        evidenceStepIds: [source.stepId],
        inputArtifactRefs: source.inputArtifactRefs.filter(
          (ref) => ref.role !== ACTIVE_CONTEXT_ARTIFACT_ROLE,
        ),
        causedByEventId,
      });
      source.continuationStepId = continuation.stepId;
      await stepRepo.save(source);
      return true;
    });
  }

  private async handleDeniedInference(
    step: ExecutionStepEntity,
    execution: ExecutionEntity,
    grantId: string,
    causedByEventId: string,
    coordination: AgentInferenceCoordination,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const stepRepo = manager.getRepository(ExecutionStepEntity);
      const locked = await stepRepo.findOne({
        where: { stepId: step.stepId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked || locked.budgetReservationId) return false;
      if (locked.status !== ExecutionStepStatus.READY) return false;
      locked.status = ExecutionStepStatus.CANCELLED;
      locked.error = {
        code: 'inference_budget_exhausted',
        message: `No ${coordination.purpose} inference budget remained`,
      };
      locked.version += 1;
      await stepRepo.save(locked);
      const operation = await manager
        .getRepository(ExecutionOperationEntity)
        .findOneByOrFail({ operationId: locked.operationId });
      operation.status = ExecutionOperationStatus.NOT_EXECUTED;
      operation.error = locked.error;
      operation.finishedAt = new Date();
      await manager.getRepository(ExecutionOperationEntity).save(operation);
      const current = await manager.getRepository(ExecutionEntity).findOne({
        where: { executionId: execution.executionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!current) throw new ConflictException('execution_not_found');

      if (coordination.purpose === 'closing') {
        await this.materializeDeterministicPartial(
          manager,
          current,
          'closing_unavailable',
          causedByEventId,
          grantId,
        );
        return true;
      }

      const continuation = await this.createInferenceContinuation(manager, {
        execution: current,
        source: locked,
        purpose: 'closing',
        payload: this.payloadWithDirective(
          this.stepPayload(locked),
          this.forcedFinalizationDirective('budget_exhausted'),
        ),
        evidenceStepIds: coordination.evidenceStepIds,
        inputArtifactRefs: locked.inputArtifactRefs.filter(
          (ref) => ref.role !== ACTIVE_CONTEXT_ARTIFACT_ROLE,
        ),
        causedByEventId,
      });
      if (coordination.sourceStepId) {
        const source = await stepRepo.findOne({
          where: { stepId: coordination.sourceStepId },
          lock: { mode: 'pessimistic_write' },
        });
        if (source) {
          source.continuationStepId = continuation.stepId;
          await stepRepo.save(source);
        }
      }
      return true;
    });
  }

  private async createInferenceContinuation(
    manager: EntityManager,
    input: {
      execution: ExecutionEntity;
      source: ExecutionStepEntity;
      purpose: 'normal' | 'repair' | 'closing';
      payload: ChatExecutionPayload;
      evidenceStepIds: string[];
      inputArtifactRefs: ExecutionStepEntity['inputArtifactRefs'];
      causedByEventId: string;
    },
  ): Promise<ExecutionStepEntity> {
    const contextArtifact = await freezeActiveContextArtifact(manager, {
      rootExecutionId: input.execution.rootExecutionId,
      sessionId: input.execution.sessionId,
      turnId: input.execution.turnId,
      causedByEventId: input.causedByEventId,
      effectivePayload: input.payload,
      derivedFromArtifactIds: input.inputArtifactRefs.map(
        (artifact) => artifact.artifactId,
      ),
    });
    const phase =
      input.purpose === 'repair'
        ? 'output_repair'
        : input.purpose === 'closing'
          ? 'forced_finalization'
          : 'agent_loop';
    const taskType = input.source.work.taskType;
    if (taskType !== 'assistant-chat' && taskType !== 'agent-chat') {
      throw new ConflictException('invalid_agent_inference_task');
    }
    const continuation = await createExecutionStep(manager, {
      executionId: input.execution.executionId,
      stepKind: ExecutionStepKind.INFERENCE,
      dependsOnStepIds: input.evidenceStepIds,
      inputArtifactRefs: [
        ...input.inputArtifactRefs,
        {
          role: ACTIVE_CONTEXT_ARTIFACT_ROLE,
          artifactId: contextArtifact.artifactId,
        },
      ],
      work: {
        ...executionTaskWork(taskType, input.payload),
        agentName:
          typeof input.source.work.agentName === 'string'
            ? input.source.work.agentName
            : taskType === 'agent-chat'
              ? 'agent'
              : 'assistant',
        agentLoop: {
          schemaVersion: 'agent-inference/1',
          purpose: input.purpose,
          phase,
          sourceStepId: input.source.stepId,
          evidenceStepIds: input.evidenceStepIds,
        } satisfies AgentInferenceCoordination,
      },
      requiredCapabilities: [taskType],
      priority: input.source.priority,
      causedByEventId: input.causedByEventId,
    });
    input.execution.phase = null;
    input.execution.result = null;
    await manager.getRepository(ExecutionEntity).save(input.execution);
    return continuation;
  }

  private continuationDirective(
    source: ExecutionStepEntity,
  ): AgentLoopContinuation {
    const value = source.work.agentLoopContinuation;
    if (!value || typeof value !== 'object') return { kind: 'normal' };
    const continuation = value as AgentLoopContinuation;
    if (
      continuation.kind === 'normal' ||
      continuation.kind === 'closing' ||
      continuation.kind === 'partial'
    ) {
      return continuation;
    }
    throw new ConflictException('agent_loop_continuation_invalid');
  }

  private stepPayload(step: ExecutionStepEntity): ChatExecutionPayload {
    if (
      step.work.taskType !== 'assistant-chat' &&
      step.work.taskType !== 'agent-chat'
    ) {
      throw new ConflictException('invalid_agent_inference_task');
    }
    if (!step.work.payload || typeof step.work.payload !== 'object') {
      throw new ConflictException('invalid_agent_inference_payload');
    }
    return step.work.payload as ChatExecutionPayload;
  }

  private forcedFinalizationDirective(
    reason: 'budget_exhausted' | 'tool_budget_exhausted',
  ): RuntimeDirective {
    return {
      schemaVersion: 'runtime-directive/1',
      kind: 'forced_finalization',
      reason,
      toolsAllowed: false,
    };
  }

  private payloadWithDirective(
    payload: ChatExecutionPayload,
    directive: RuntimeDirective,
  ): ChatExecutionPayload {
    const activeCapabilities = payload.activeCapabilities ?? null;
    return {
      ...payload,
      runtimeDirective: directive,
      ...(directive.toolsAllowed || !activeCapabilities
        ? {}
        : {
            activeCapabilities: {
              ...activeCapabilities,
              tools: [],
            },
          }),
    };
  }

  private async materializeDeterministicPartial(
    manager: EntityManager,
    execution: ExecutionEntity,
    trigger:
      | 'closing_unavailable'
      | 'closing_output_empty'
      | 'exact_tool_repeat_persisted',
    causedByEventId: string,
    explicitGrantId?: string,
  ): Promise<void> {
    const eventRepo = manager.getRepository(ExecutionEventEntity);
    const rows = await eventRepo.find({
      where: { rootExecutionId: execution.rootExecutionId },
      order: { sequence: 'ASC' },
    });
    const starts = new Map(
      rows
        .filter(
          (row) =>
            row.executionId === execution.executionId &&
            row.eventType === 'operation.started' &&
            (row.envelope.payload as Record<string, unknown>)?.operationKind ===
              'tool_call',
        )
        .map((row) => [row.operationId, row]),
    );
    const completedOperations = rows.flatMap((row) => {
      const payload = row.envelope.payload as Record<string, unknown>;
      const start = starts.get(row.operationId);
      const startPayload = start?.envelope.payload as
        Record<string, unknown> | undefined;
      if (
        row.executionId !== execution.executionId ||
        row.eventType !== 'operation.finished' ||
        payload?.operationKind !== 'tool_call' ||
        payload.status !== 'succeeded' ||
        payload.resultSummaryKind !== 'leaf_tool' ||
        typeof payload.resultSummary !== 'string' ||
        !start ||
        !row.operationId ||
        !row.envelope.toolCallId
      ) {
        return [];
      }
      return [
        {
          operationId: row.operationId,
          toolCallId: String(row.envelope.toolCallId),
          name: String(startPayload?.name ?? 'tool'),
          summary: payload.resultSummary,
        },
      ];
    });
    const grantId =
      explicitGrantId ??
      Object.keys(execution.progressLedger?.operationBudget?.grants ?? {})[0];
    if (!grantId || !completedOperations.length) {
      execution.error = {
        code: 'terminal_candidate_unavailable',
        message:
          'The execution budget ended before any confirmed result could be summarized',
      };
      execution.phase = 'terminal_pending_failed';
      await manager.getRepository(ExecutionEntity).save(execution);
      return;
    }
    const loopPartial = trigger === 'exact_tool_repeat_persisted';
    const partialResult: DeterministicPartialResult = {
      version: '1',
      trigger,
      loopId: execution.executionId,
      grantId,
      completedOperations,
      pending: loopPartial ? ['strategy_change'] : ['final_synthesis'],
      ...(loopPartial
        ? {
            continuation: {
              kind: 'new_turn' as const,
              reason: 'different_strategy_required' as const,
            },
          }
        : {}),
    };
    const reply = loopPartial
      ? [
          'I stopped because the same tool action kept repeating.',
          '',
          'Completed work:',
          ...completedOperations.map(
            (item) => `- ${item.name}: ${item.summary}`,
          ),
          '',
          'Pending:',
          '- Continue in a new turn with a different strategy.',
        ].join('\n')
      : [
          "I couldn't produce the final synthesis because this turn reached its execution limit.",
          '',
          'Completed work:',
          ...completedOperations.map(
            (item) => `- ${item.name}: ${item.summary}`,
          ),
          '',
          'Pending:',
          '- Final synthesis of the completed results.',
        ].join('\n');
    const root =
      execution.executionId === execution.rootExecutionId
        ? execution
        : await manager.getRepository(ExecutionEntity).findOneOrFail({
            where: {
              executionId: execution.rootExecutionId,
              rootExecutionId: execution.rootExecutionId,
            },
            lock: { mode: 'pessimistic_write' },
          });
    const artifactId = randomUUID();
    const body = Buffer.from(reply, 'utf8');
    await manager.getRepository(ExecutionArtifactEntity).save(
      manager.getRepository(ExecutionArtifactEntity).create({
        artifactId,
        rootExecutionId: execution.rootExecutionId,
        kind: 'model_response',
        contentHash: contentHash(body),
        size: String(body.length),
        mediaType: 'text/plain',
        encoding: 'identity',
        dataClassification: 'workspace',
        redaction: { applied: false },
        retentionClass: 'evaluation',
        createdByEventId: null,
        inputSourceIds: [],
        storageRef: `execution:${execution.rootExecutionId}:artifact:${artifactId}`,
        body,
      }),
    );
    const event = await appendBackendExecutionEvent(
      manager,
      root,
      nextBackendProducerSequence(rows),
      {
        eventType: 'message.recorded',
        payloadSchema: 'message.recorded/1',
        payload: {
          messageKind: 'final_response',
          role: 'assistant',
          contentPreview: reply.slice(0, 512),
          contentArtifactId: artifactId,
          format: 'text',
          generationSource: 'runtime_template',
        },
        actor: { type: 'system' },
        executionId: execution.executionId,
        turnId: execution.turnId,
        causedByEventId,
        artifactRefs: [artifactId],
      },
      Number(root.lastSequence) + 1,
    );
    root.lastSequence = event.sequence;
    root.lastEventId = event.eventId;
    execution.lastSequence = event.sequence;
    execution.lastEventId = event.eventId;
    execution.result = {
      reply,
      error: null,
      completionKind: 'partial',
      completionReason: loopPartial
        ? 'partial_loop_guard'
        : 'partial_budget_exhausted',
      completionSource: 'runtime_template',
      partialResult,
    };
    execution.error = null;
    execution.phase = COORDINATION_PENDING_PHASE;
    await manager.getRepository(ExecutionEntity).save(root);
    if (root.executionId !== execution.executionId) {
      await manager.getRepository(ExecutionEntity).save(execution);
    }
  }
}

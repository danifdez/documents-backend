import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { canonicalHash } from '../execution/execution-canonical';
import { ExecutionEventEntity } from '../execution/execution-event.entity';
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
import {
  ACTIVE_CONTEXT_ARTIFACT_ROLE,
  freezeActiveContextArtifact,
} from '../conversation/conversation-context';

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
export class ExecutionAgentLoopService {
  private readonly logger = new Logger(ExecutionAgentLoopService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly progress: ExecutionProgressService,
    private readonly toolPlans: ExecutionToolPlanService,
  ) {}

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
        ORDER BY receipt."received_at"
        LIMIT $1
      `,
      [limit, TOOL_LOOP_TASK_TYPES],
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
          AND COALESCE(execution."phase", '') NOT LIKE 'terminal_pending_%'
        ORDER BY step."updated_at"
        LIMIT $1
      `,
      [limit, TOOL_LOOP_TASK_TYPES],
    );
    let materialized = 0;
    for (const row of rows) {
      if (await this.materializeToolContinuation(String(row.step_id))) {
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
    const decision = await this.progress.reserveOperationBudget(
      root.executionId,
      {
        executionId: root.executionId,
        loopId: root.executionId,
        grantId: grant.grantId,
        operationId: step.operationId,
        operationKind: 'inference',
        bucket: 'normal',
        phase: 'agent_loop',
        round,
        name:
          execution.taskType === 'delegated-agent'
            ? 'delegated-agent'
            : String(step.work.taskType ?? execution.taskType),
      },
    );
    if (!decision.granted) {
      throw new ConflictException(decision.reservation.reason);
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
      locked.budgetReservationId = decision.reservation.reservationId;
      await manager.save(locked);
      return true;
    });
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
        if (!decision.granted) continue;
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
    let confirmationPending = false;
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
      if (!finish) throw new ConflictException('tool_batch_finish_missing');

      const work = source.work ?? {};
      const payload =
        work.payload && typeof work.payload === 'object'
          ? (work.payload as Record<string, unknown>)
          : {};
      const history = Array.isArray(payload.toolHistory)
        ? (payload.toolHistory as ToolRound[])
        : [];
      const effectivePayload = {
        ...payload,
        toolHistory: [
          ...history,
          { round: sourceReservation.round, calls, results },
        ],
      };
      const contextArtifact = await freezeActiveContextArtifact(manager, {
        rootExecutionId: execution.rootExecutionId,
        sessionId: execution.sessionId,
        turnId: execution.turnId,
        causedByEventId: finish.eventId,
        effectivePayload,
        derivedFromArtifactIds: continuationArtifacts.map(
          (artifact) => artifact.artifactId,
        ),
      });
      const continuation = await createExecutionStep(manager, {
        executionId: execution.executionId,
        stepKind: ExecutionStepKind.INFERENCE,
        dependsOnStepIds: toolStepIds as string[],
        inputArtifactRefs: [
          ...continuationArtifacts,
          {
            role: ACTIVE_CONTEXT_ARTIFACT_ROLE,
            artifactId: contextArtifact.artifactId,
          },
        ],
        work: {
          taskType: execution.taskType,
          agentName:
            execution.taskType === 'agent-chat' ? 'agent' : 'assistant',
          payload: effectivePayload,
        },
        requiredCapabilities: [execution.taskType],
        priority: source.priority,
        causedByEventId: finish.eventId,
      });
      source.continuationStepId = continuation.stepId;
      await stepRepo.save(source);
      execution.phase = null;
      execution.result = null;
      await manager.getRepository(ExecutionEntity).save(execution);
      return true;
    });
  }
}

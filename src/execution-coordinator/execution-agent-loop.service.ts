import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { canonicalHash } from '../execution/execution-canonical';
import { ExecutionEventEntity } from '../execution/execution-event.entity';
import { ExecutionResultReceiptEntity } from '../execution/execution-result-receipt.entity';
import { ExecutionStepEntity } from '../execution/execution-step.entity';
import { ExecutionStepStatus } from '../execution/execution-step-status.enum';
import { ExecutionToolPlanService } from '../execution/execution-tool-plan.service';
import { ExecutionEntity } from '../execution/execution.entity';
import { ExecutionService } from '../execution/execution.service';

const CHAT_TASK_TYPES = ['assistant-chat', 'agent-chat'];
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

@Injectable()
export class ExecutionAgentLoopService {
  private readonly logger = new Logger(ExecutionAgentLoopService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly executions: ExecutionService,
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
          AND execution."status" IN ('queued', 'running')
        ORDER BY receipt."received_at"
        LIMIT $1
      `,
      [limit],
    );
    let materialized = 0;
    for (const row of rows) {
      materialized += await this.materializeToolBatch(String(row.step_id));
    }
    return materialized;
  }

  private async prepareInference(stepId: string): Promise<boolean> {
    const step = await this.dataSource
      .getRepository(ExecutionStepEntity)
      .findOneBy({ stepId });
    if (!step || step.budgetReservationId) return false;
    const execution = await this.dataSource
      .getRepository(ExecutionEntity)
      .findOneByOrFail({ executionId: step.executionId });
    const { grant } = await this.executions.requestProgressGrant(
      execution.executionId,
      {
        executionId: execution.executionId,
        turnId: execution.turnId!,
        loopId: execution.executionId,
        agentName: execution.taskType === 'agent-chat' ? 'agent' : 'assistant',
        loopKind: 'top_level',
        requestedPolicy: DEFAULT_POLICY,
      },
    );
    const refreshed = await this.dataSource
      .getRepository(ExecutionEntity)
      .findOneByOrFail({ executionId: step.executionId });
    const existingReservation =
      refreshed.progressLedger?.operationBudget?.reservations[step.operationId];
    const round =
      existingReservation?.round ?? this.nextInferenceRound(refreshed);
    const decision = await this.executions.reserveOperationBudget(
      execution.executionId,
      {
        executionId: execution.executionId,
        loopId: execution.executionId,
        grantId: grant.grantId,
        operationId: step.operationId,
        operationKind: 'inference',
        bucket: 'normal',
        phase: 'agent_loop',
        round,
        name: String(step.work.taskType ?? execution.taskType),
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
        const decision = await this.executions.reserveOperationBudget(
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
        const alreadyMaterialized = prepared.plan.stepId !== null;
        await this.toolPlans.materialize(
          call.toolCallId,
          decision.reservation.reservationId,
        );
        if (!alreadyMaterialized) materialized += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Failed to materialize tool request ${call.toolCallId}: ${message}`,
        );
        throw error;
      }
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
}

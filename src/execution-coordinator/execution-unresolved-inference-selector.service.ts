import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { COORDINATION_PENDING_PHASE } from '../execution/execution.constants';
import { ExecutionStatus } from '../execution/execution-status.enum';
import { ExecutionStepEntity } from '../execution/execution-step.entity';
import { ExecutionStepKind } from '../execution/execution-step-kind.enum';
import { ExecutionStepStatus } from '../execution/execution-step-status.enum';
import { ExecutionEntity } from '../execution/execution.entity';
import { ExecutionNextStepSelector } from './execution-next-work.types';

const AGENT_LOOP_TASK_TYPES = [
  'assistant-chat',
  'agent-chat',
  'delegated-agent',
];

@Injectable()
export class ExecutionUnresolvedInferenceSelectorService implements ExecutionNextStepSelector {
  readonly selectorId = 'unresolved-inference';

  constructor(private readonly dataSource: DataSource) {}

  async selectNextWork(limit = 20): Promise<number> {
    const rows = await this.dataSource.query(
      `
        SELECT step."step_id"
        FROM "execution_steps" step
        INNER JOIN "executions" execution
          ON execution."execution_id" = step."execution_id"
        WHERE step."status" = 'completed'
          AND step."step_kind" = 'inference'
          AND step."continuation_processed_at" IS NULL
          AND step."result" #>> '{outcome,kind}' IN ('invalid', 'tool_requests')
          AND NOT (execution."task_type" = ANY($2::text[]))
          AND execution."status" IN ('queued', 'running')
          AND execution."cancellation_requested_at" IS NULL
          AND execution."phase" = $3
        ORDER BY step."updated_at"
        LIMIT $1
      `,
      [limit, AGENT_LOOP_TASK_TYPES, COORDINATION_PENDING_PHASE],
    );
    let selected = 0;
    for (const row of rows) {
      if (await this.failUnsupportedOutcome(String(row.step_id))) {
        selected += 1;
      }
    }
    return selected;
  }

  private async failUnsupportedOutcome(stepId: string): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const step = await manager.getRepository(ExecutionStepEntity).findOne({
        where: { stepId },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !step ||
        step.status !== ExecutionStepStatus.COMPLETED ||
        step.stepKind !== ExecutionStepKind.INFERENCE ||
        step.continuationProcessedAt
      ) {
        return false;
      }
      const outcome = (step.result as Record<string, unknown> | null)
        ?.outcome as Record<string, unknown> | undefined;
      if (outcome?.kind !== 'invalid' && outcome?.kind !== 'tool_requests') {
        return false;
      }
      const execution = await manager.getRepository(ExecutionEntity).findOne({
        where: { executionId: step.executionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !execution ||
        ![ExecutionStatus.QUEUED, ExecutionStatus.RUNNING].includes(
          execution.status,
        ) ||
        execution.phase !== COORDINATION_PENDING_PHASE ||
        AGENT_LOOP_TASK_TYPES.includes(execution.taskType) ||
        execution.cancellationRequestedAt
      ) {
        return false;
      }

      const invalid = outcome.kind === 'invalid';
      step.continuationProcessedAt = new Date();
      await manager.getRepository(ExecutionStepEntity).save(step);
      execution.result = null;
      execution.error = {
        code: invalid
          ? 'invalid_inference_outcome'
          : 'unsupported_inference_continuation',
        message: invalid
          ? `Inference output for ${execution.taskType} did not satisfy its contract`
          : `Inference task ${execution.taskType} cannot request tools without a registered continuation selector`,
        ...(invalid && typeof outcome.reason === 'string'
          ? { reason: outcome.reason }
          : {}),
      };
      execution.phase = 'terminal_pending_failed';
      await manager.getRepository(ExecutionEntity).save(execution);
      return true;
    });
  }
}

import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { ExecutionConfirmationEntity } from '../execution/execution-confirmation.entity';
import { ExecutionOperationEntity } from '../execution/execution-operation.entity';
import { ExecutionStatus } from '../execution/execution-status.enum';
import { ExecutionStepEntity } from '../execution/execution-step.entity';
import { ExecutionToolPlanEntity } from '../execution/execution-tool-plan.entity';
import { ExecutionEntity } from '../execution/execution.entity';
import { COORDINATION_PENDING_PHASE } from '../execution/execution.constants';
import { selectTerminalCandidate } from './execution-terminal-candidate.policy';

@Injectable()
export class ExecutionTerminalCandidateService {
  constructor(private readonly dataSource: DataSource) {}

  async promoteReady(limit = 20): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager.query(
        `
          SELECT execution."execution_id"
          FROM "executions" execution
          WHERE execution."status" = 'running'
            AND execution."phase" = $1
            AND execution."cancellation_requested_at" IS NULL
            AND execution."result" IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM "execution_steps" step
              WHERE step."execution_id" = execution."execution_id"
            )
            AND NOT EXISTS (
              SELECT 1 FROM "execution_steps" step
              WHERE step."execution_id" = execution."execution_id"
                AND step."status" IN ('blocked', 'ready', 'running', 'result_received')
            )
            AND NOT EXISTS (
              SELECT 1 FROM "execution_steps" step
              WHERE step."execution_id" = execution."execution_id"
                AND step."step_kind" = 'inference'
                AND step."status" = 'completed'
                AND step."result" #>> '{outcome,kind}' = 'tool_requests'
                AND (
                  step."continuation_processed_at" IS NULL
                  OR (
                    step."continuation_step_id" IS NULL
                    AND COALESCE(
                      step."work" -> 'agentLoopTerminalPrepared',
                      'false'::jsonb
                    ) <> 'true'::jsonb
                  )
                )
            )
            AND NOT EXISTS (
              SELECT 1 FROM "execution_steps" step
              WHERE step."execution_id" = execution."execution_id"
                AND step."step_kind" = 'inference'
                AND step."status" = 'completed'
                AND step."result" #>> '{outcome,kind}' = 'invalid'
                AND COALESCE(
                  step."work" -> 'agentLoopTerminalPrepared',
                  'false'::jsonb
                ) <> 'true'::jsonb
            )
            AND NOT EXISTS (
              SELECT 1 FROM "execution_confirmations" confirmation
              WHERE confirmation."execution_id" = execution."execution_id"
                AND confirmation."status" = 'pending'
            )
            AND NOT EXISTS (
              SELECT 1 FROM "execution_tool_plans" plan
              WHERE plan."execution_id" = execution."execution_id"
                AND plan."step_id" IS NULL
            )
            AND NOT EXISTS (
              SELECT 1 FROM "executions" child
              WHERE child."parent_execution_id" = execution."execution_id"
                AND child."status" NOT IN ('completed', 'failed', 'cancelled')
            )
            AND NOT EXISTS (
              SELECT 1 FROM "execution_operations" operation
              WHERE operation."execution_id" = execution."execution_id"
                AND operation."status" IN ('planned', 'prepared', 'dispatched', 'unknown')
            )
          ORDER BY execution."updated_at", execution."execution_id"
          LIMIT $2
          FOR UPDATE OF execution SKIP LOCKED
        `,
        [COORDINATION_PENDING_PHASE, limit],
      );
      let promoted = 0;
      for (const row of rows) {
        const executionId = String(row.execution_id);
        const execution = await manager
          .getRepository(ExecutionEntity)
          .findOneBy({ executionId });
        if (!execution) continue;
        const [steps, operations, pendingConfirmations, plans, activeChildren] =
          await Promise.all([
            manager
              .getRepository(ExecutionStepEntity)
              .find({ where: { executionId }, order: { createdAt: 'ASC' } }),
            manager
              .getRepository(ExecutionOperationEntity)
              .find({ where: { executionId } }),
            manager.getRepository(ExecutionConfirmationEntity).countBy({
              executionId,
              status: 'pending',
            }),
            manager
              .getRepository(ExecutionToolPlanEntity)
              .find({ where: { executionId } }),
            manager.getRepository(ExecutionEntity).count({
              where: {
                parentExecutionId: executionId,
                status: In([
                  ExecutionStatus.QUEUED,
                  ExecutionStatus.RUNNING,
                  ExecutionStatus.WAITING,
                ]),
              },
            }),
          ]);
        const decision = selectTerminalCandidate({
          status: execution.status,
          phase: execution.phase,
          cancellationRequested: Boolean(execution.cancellationRequestedAt),
          result: execution.result,
          steps: steps.map((step) => ({
            stepId: step.stepId,
            stepKind: step.stepKind,
            status: step.status,
            result: step.result,
            continuationProcessed: step.continuationProcessedAt !== null,
            continuationStepId: step.continuationStepId,
            terminalCandidatePrepared:
              step.work.agentLoopTerminalPrepared === true,
          })),
          operationStatuses: operations.map((operation) => operation.status),
          pendingConfirmations,
          unmaterializedToolPlans: plans.filter((plan) => !plan.stepId).length,
          activeChildren,
        });
        if (decision.kind === 'blocked') continue;
        execution.phase = 'backend_finalization';
        execution.completionKind = decision.completionKind;
        execution.completionReason = decision.completionReason;
        await manager.getRepository(ExecutionEntity).save(execution);
        promoted += 1;
      }
      return promoted;
    });
  }
}

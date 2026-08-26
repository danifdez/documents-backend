import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import {
  DataSource,
  EntityManager,
  In,
  LessThanOrEqual,
  MoreThan,
} from 'typeorm';
import { WorkerEntity } from '../worker/worker.entity';
import {
  ClaimExecutionStepInput,
  GrantExecutionStepAttemptInput,
  ReceiveExecutionStepResultInput,
  OutputArtifactReceiptAck,
  StepAssignment,
  StepResultReceiptAck,
} from './execution-control-plane.types';
import { IncomingExecutionArtifact } from './execution.types';
import {
  assertAttemptTransition,
  assertStepTransition,
} from './execution-control-plane.transitions';
import { ExecutionResultReceiptEntity } from './execution-result-receipt.entity';
import { ExecutionStepAttemptStatus } from './execution-step-attempt-status.enum';
import { ExecutionStepAttemptEntity } from './execution-step-attempt.entity';
import { ExecutionStepDependencyEntity } from './execution-step-dependency.entity';
import { ExecutionStepEntity } from './execution-step.entity';
import { ExecutionStepStatus } from './execution-step-status.enum';
import { ExecutionContractValidator } from './execution-contract-validator';
import { ExecutionArtifactEntity } from './execution-artifact.entity';
import { ExecutionEntity } from './execution.entity';
import { ExecutionOperationEntity } from './execution-operation.entity';
import { ExecutionOperationRecoveryClass } from './execution-operation-recovery-class.enum';
import { ExecutionOperationStatus } from './execution-operation-status.enum';
import { ExecutionStatus } from './execution-status.enum';
import { releaseExecutionStepDependents } from './execution-step.service';
import { executionStepOutputValue } from './execution-step-result';
import { ExecutionStepKind } from './execution-step-kind.enum';
import { ExecutionToolPlanEntity } from './execution-tool-plan.entity';
import { ToolResultContract } from './execution-tool.types';
import { ExecutionEventEntity } from './execution-event.entity';
import {
  appendBackendExecutionEvent,
  nextBackendProducerSequence,
} from './execution-event.writer';
import { ProgressEvent, projectExecutionProgress } from './execution-progress';
import { ExecutionOperationKind } from './execution-operation-kind.enum';
import { recordLoadedSkillResource } from '../conversation/skill-activation';
import { SKILL_RESOURCE_LOAD_TOOL_NAME } from './execution-tool.constants';

const MIN_LEASE_MS = 1_000;
const MAX_LEASE_MS = 15 * 60 * 1_000;
const MAX_CLAIM_WAIT_MS = 30_000;
const CLAIM_RETRY_INTERVAL_MS = 1_000;
const MAX_OUTPUT_ARTIFACT_BYTES = 8 * 1024 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new BadRequestException('invalid_step_result');
  }
  return value;
}

function resultHash(result: Record<string, unknown>): string {
  const canonical = JSON.stringify(canonicalValue(result));
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

function toolResultFromStepResult(
  result: Record<string, unknown>,
): ToolResultContract | null {
  if (result.stepKind !== ExecutionStepKind.TOOL) return null;
  const output = result.output as Record<string, unknown> | undefined;
  return (output?.toolResult as ToolResultContract | undefined) ?? null;
}

function expectedStepResultStatus(
  toolStatus: ToolResultContract['status'],
): 'succeeded' | 'failed' | 'cancelled' {
  if (toolStatus === 'succeeded') return 'succeeded';
  if (toolStatus === 'cancelled') return 'cancelled';
  return 'failed';
}

function operationStatusForToolResult(
  toolStatus: ToolResultContract['status'],
): ExecutionOperationStatus {
  const statuses: Record<
    ToolResultContract['status'],
    ExecutionOperationStatus
  > = {
    succeeded: ExecutionOperationStatus.SUCCEEDED,
    failed: ExecutionOperationStatus.FAILED,
    cancelled: ExecutionOperationStatus.CANCELLED,
    unknown: ExecutionOperationStatus.UNKNOWN,
    not_executed: ExecutionOperationStatus.NOT_EXECUTED,
  };
  return statuses[toolStatus];
}

function operationKindForStep(
  stepKind: ExecutionStepKind,
): ExecutionOperationKind {
  if (stepKind === ExecutionStepKind.INFERENCE) {
    return ExecutionOperationKind.INFERENCE;
  }
  if (
    stepKind === ExecutionStepKind.TOOL ||
    stepKind === ExecutionStepKind.CODE
  ) {
    return ExecutionOperationKind.TOOL_CALL;
  }
  if (stepKind === ExecutionStepKind.VERIFICATION) {
    return ExecutionOperationKind.VERIFICATION;
  }
  return ExecutionOperationKind.ARTIFACT_PROCESSING;
}

@Injectable()
export class ExecutionAttemptService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly contractValidator?: ExecutionContractValidator,
  ) {}

  async grantAttempt(
    input: GrantExecutionStepAttemptInput,
  ): Promise<ExecutionStepAttemptEntity> {
    this.assertLeaseDuration(input.leaseDurationMs);

    return this.dataSource.transaction(async (manager) => {
      const stepRepo = manager.getRepository(ExecutionStepEntity);
      const step = await stepRepo.findOne({
        where: { stepId: input.stepId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!step) throw new NotFoundException('step_not_found');
      return this.grantLockedAttempt(manager, step, input);
    });
  }

  async claimReadyStep(
    input: ClaimExecutionStepInput,
  ): Promise<StepAssignment | null> {
    this.assertLeaseDuration(input.leaseDurationMs);
    const stepKinds = [...new Set(input.stepKinds)];
    if (!stepKinds.length) throw new BadRequestException('missing_step_kinds');
    const capabilities = [...new Set(input.capabilities)];

    return this.dataSource.transaction(async (manager) => {
      if (input.enforceRegisteredWorkerCapacity) {
        const worker = await manager.getRepository(WorkerEntity).findOne({
          where: { id: input.workerId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!worker || worker.status !== 'online' || worker.revokedAt) {
          throw new ConflictException('worker_not_available');
        }
        if (
          stepKinds.some((kind) => !worker.stepKinds.includes(kind)) ||
          capabilities.some(
            (capability) => !worker.capabilities.includes(capability),
          )
        ) {
          throw new BadRequestException('claim_capabilities_not_registered');
        }
        const activeAssignments = await manager
          .getRepository(ExecutionStepAttemptEntity)
          .count({
            where: {
              claimedBy: input.workerId,
              status: In([
                ExecutionStepAttemptStatus.LEASED,
                ExecutionStepAttemptStatus.RUNNING,
              ]),
              leaseExpiresAt: MoreThan(new Date()),
            },
          });
        if (activeAssignments >= worker.maximumConcurrency) return null;
      }
      const rows = await manager.query(
        `
          SELECT "step_id"
          FROM "execution_steps"
          WHERE "status" = 'ready'
            AND "available_at" <= now()
            AND ("deadline" IS NULL OR "deadline" > now())
            AND "step_kind" = ANY($1::text[])
            AND "required_capabilities" <@ $2::text[]
            AND (
              "step_kind" <> 'inference'
              OR "budget_reservation_id" IS NOT NULL
              OR "work" ->> 'taskType' IN (
                'context-input-map',
                'context-input-reduce'
              )
              OR NOT EXISTS (
                SELECT 1
                FROM "executions" governed_execution
                WHERE governed_execution."execution_id" = "execution_steps"."execution_id"
                  AND governed_execution."task_type" IN (
                    'assistant-chat',
                    'agent-chat',
                    'delegated-agent'
                  )
              )
            )
            AND EXISTS (
              SELECT 1
              FROM "executions"
              WHERE "executions"."execution_id" = "execution_steps"."execution_id"
                AND "executions"."status" IN ('queued', 'running')
                AND "executions"."cancellation_requested_at" IS NULL
                AND (
                  $3::varchar IS NULL
                  OR "executions"."owner_principal" = $3::varchar
                )
            )
          ORDER BY "priority" DESC, "available_at", "created_at"
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `,
        [stepKinds, capabilities, input.ownerPrincipal ?? null],
      );
      if (!rows.length) return null;

      const step = await manager.getRepository(ExecutionStepEntity).findOneBy({
        stepId: rows[0].step_id,
      });
      if (!step) return null;
      const attempt = await this.grantLockedAttempt(manager, step, input);
      const dependencies = await manager
        .getRepository(ExecutionStepDependencyEntity)
        .findBy({ stepId: step.stepId });
      const assignment: StepAssignment = {
        schemaVersion: 'step-assignment/1',
        executionId: step.executionId,
        stepId: step.stepId,
        operationId: step.operationId,
        attemptId: attempt.attemptId,
        stepKind: step.stepKind,
        dependsOnStepIds: dependencies.map(
          (dependency) => dependency.dependsOnStepId,
        ),
        inputArtifactRefs: step.inputArtifactRefs,
        work: step.work,
        limits: { maxDurationMs: input.leaseDurationMs },
        deadline: (step.deadline && step.deadline < attempt.leaseExpiresAt
          ? step.deadline
          : attempt.leaseExpiresAt
        ).toISOString(),
      };
      this.contractValidator?.assertStepAssignment(
        assignment as unknown as Record<string, unknown>,
      );
      return assignment;
    });
  }

  async claimReadyStepWithWait(
    input: ClaimExecutionStepInput,
    waitTimeoutMs: number,
  ): Promise<StepAssignment | null> {
    if (
      !Number.isInteger(waitTimeoutMs) ||
      waitTimeoutMs < 0 ||
      waitTimeoutMs > MAX_CLAIM_WAIT_MS
    ) {
      throw new BadRequestException('invalid_claim_wait');
    }

    const deadline = Date.now() + waitTimeoutMs;
    while (true) {
      const assignment = await this.claimReadyStep(input);
      if (assignment || Date.now() >= deadline) return assignment;

      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.min(CLAIM_RETRY_INTERVAL_MS, deadline - Date.now()),
        ),
      );
    }
  }

  async startAttempt(
    attemptId: string,
    workerId: string,
  ): Promise<ExecutionStepAttemptEntity> {
    return this.dataSource.transaction(async (manager) => {
      const { attempt } = await this.lockCurrentAttempt(
        manager,
        attemptId,
        workerId,
      );
      if (attempt.leaseExpiresAt <= new Date()) {
        throw new ConflictException('lease_expired');
      }
      if (attempt.status === ExecutionStepAttemptStatus.RUNNING) {
        return attempt;
      }
      assertAttemptTransition(
        attempt.status,
        ExecutionStepAttemptStatus.RUNNING,
      );
      const now = new Date();
      attempt.status = ExecutionStepAttemptStatus.RUNNING;
      attempt.startedAt = now;
      attempt.heartbeatAt = now;
      return manager.getRepository(ExecutionStepAttemptEntity).save(attempt);
    });
  }

  async uploadOutputArtifact(
    attemptId: string,
    workerId: string,
    artifact: IncomingExecutionArtifact,
  ): Promise<OutputArtifactReceiptAck> {
    const acknowledgedAt = new Date();
    const ack = (
      code: OutputArtifactReceiptAck['code'],
    ): OutputArtifactReceiptAck => ({
      artifactId: artifact.artifactId,
      attemptId,
      code,
      acknowledgedAt,
    });
    const body = this.validateOutputArtifact(artifact);

    return this.dataSource.transaction(async (manager) => {
      const attempt = await manager
        .getRepository(ExecutionStepAttemptEntity)
        .findOne({
          where: { attemptId },
          lock: { mode: 'pessimistic_write' },
        });
      if (!attempt || attempt.claimedBy !== workerId) {
        return ack('stale_attempt');
      }
      const step = await manager.getRepository(ExecutionStepEntity).findOneBy({
        stepId: attempt.stepId,
      });
      if (
        !step ||
        step.currentAttemptId !== attemptId ||
        attempt.leaseExpiresAt <= acknowledgedAt ||
        ![
          ExecutionStepAttemptStatus.LEASED,
          ExecutionStepAttemptStatus.RUNNING,
        ].includes(attempt.status)
      ) {
        return ack('stale_attempt');
      }
      const execution = await manager
        .getRepository(ExecutionEntity)
        .findOneBy({ executionId: attempt.executionId });
      if (!execution) return ack('stale_attempt');

      const artifactRepo = manager.getRepository(ExecutionArtifactEntity);
      const existing = await artifactRepo.findOneBy({
        artifactId: artifact.artifactId,
      });
      if (existing) {
        return existing.rootExecutionId === execution.rootExecutionId &&
          existing.producedByAttemptId === attemptId &&
          existing.kind === artifact.kind &&
          existing.mediaType === artifact.mediaType &&
          existing.contentHash === artifact.contentHash &&
          Number(existing.size) === artifact.size
          ? ack('duplicate')
          : ack('artifact_conflict');
      }
      if (
        execution.status === ExecutionStatus.CANCELLED ||
        execution.cancellationRequestedAt ||
        step.status === ExecutionStepStatus.CANCELLED
      ) {
        return ack('stale_attempt');
      }

      await artifactRepo.save(
        artifactRepo.create({
          artifactId: artifact.artifactId,
          rootExecutionId: execution.rootExecutionId,
          kind: artifact.kind,
          contentHash: artifact.contentHash,
          size: String(artifact.size),
          mediaType: artifact.mediaType,
          encoding: 'identity',
          dataClassification: 'workspace',
          redaction: { applied: false },
          retentionClass: 'execution',
          createdByEventId: null,
          producedByAttemptId: attemptId,
          inputSourceIds: [],
          storageRef:
            `execution:${execution.rootExecutionId}:artifact:` +
            artifact.artifactId,
          body,
        }),
      );
      return ack('received');
    });
  }

  async getInputArtifact(
    attemptId: string,
    workerId: string,
    artifactId: string,
  ): Promise<ExecutionArtifactEntity> {
    const attempt = await this.dataSource
      .getRepository(ExecutionStepAttemptEntity)
      .findOneBy({ attemptId });
    if (!attempt) throw new NotFoundException('attempt_not_found');
    const step = await this.dataSource
      .getRepository(ExecutionStepEntity)
      .findOneBy({ stepId: attempt.stepId });
    const canRead =
      step &&
      attempt.claimedBy === workerId &&
      step.currentAttemptId === attempt.attemptId &&
      attempt.leaseExpiresAt > new Date() &&
      [
        ExecutionStepAttemptStatus.LEASED,
        ExecutionStepAttemptStatus.RUNNING,
      ].includes(attempt.status) &&
      step.inputArtifactRefs.some((ref) => ref.artifactId === artifactId);
    if (!canRead) throw new ConflictException('artifact_not_authorized');

    const execution = await this.dataSource
      .getRepository(ExecutionEntity)
      .findOneBy({ executionId: attempt.executionId });
    if (!execution) throw new NotFoundException('execution_not_found');
    const artifact = await this.dataSource
      .getRepository(ExecutionArtifactEntity)
      .createQueryBuilder('artifact')
      .addSelect('artifact.body')
      .where('artifact.artifact_id = :artifactId', { artifactId })
      .andWhere('artifact.root_execution_id = :rootExecutionId', {
        rootExecutionId: execution.rootExecutionId,
      })
      .getOne();
    if (!artifact?.body) throw new NotFoundException('artifact_unavailable');
    return artifact;
  }

  async renewAttemptLease(
    attemptId: string,
    workerId: string,
    leaseDurationMs: number,
  ): Promise<{
    leaseExpiresAt: Date;
    leaseRemainingMs: number;
    cancelled: boolean;
  }> {
    this.assertLeaseDuration(leaseDurationMs);
    return this.dataSource.transaction(async (manager) => {
      const { attempt, step } = await this.lockCurrentAttempt(
        manager,
        attemptId,
        workerId,
      );
      const now = new Date();
      if (
        attempt.leaseExpiresAt <= now ||
        ![
          ExecutionStepAttemptStatus.LEASED,
          ExecutionStepAttemptStatus.RUNNING,
        ].includes(attempt.status)
      ) {
        throw new ConflictException('lease_expired');
      }
      const execution = await manager
        .getRepository(ExecutionEntity)
        .findOneBy({ executionId: attempt.executionId });
      const cancelled =
        execution?.status === ExecutionStatus.CANCELLED ||
        Boolean(execution?.cancellationRequestedAt) ||
        step.status === ExecutionStepStatus.CANCELLED;
      if (cancelled) {
        return {
          leaseExpiresAt: attempt.leaseExpiresAt,
          leaseRemainingMs: Math.max(
            0,
            attempt.leaseExpiresAt.getTime() - now.getTime(),
          ),
          cancelled,
        };
      }

      const requestedExpiry = new Date(now.getTime() + leaseDurationMs);
      attempt.leaseExpiresAt =
        step.deadline && step.deadline < requestedExpiry
          ? step.deadline
          : requestedExpiry;
      if (attempt.leaseExpiresAt <= now) {
        throw new ConflictException('step_deadline_reached');
      }
      attempt.heartbeatAt = now;
      await manager.getRepository(ExecutionStepAttemptEntity).save(attempt);
      return {
        leaseExpiresAt: attempt.leaseExpiresAt,
        leaseRemainingMs: attempt.leaseExpiresAt.getTime() - now.getTime(),
        cancelled: false,
      };
    });
  }

  async readAttemptControl(
    attemptId: string,
    workerId: string,
  ): Promise<{
    cancelled: boolean;
    leaseExpiresAt: Date;
    deadline: Date | null;
  }> {
    const attempt = await this.dataSource
      .getRepository(ExecutionStepAttemptEntity)
      .findOneBy({ attemptId });
    if (!attempt || attempt.claimedBy !== workerId) {
      throw new NotFoundException('attempt_not_found');
    }
    const step = await this.dataSource
      .getRepository(ExecutionStepEntity)
      .findOneBy({ stepId: attempt.stepId });
    const execution = await this.dataSource
      .getRepository(ExecutionEntity)
      .findOneBy({ executionId: attempt.executionId });
    if (!step || !execution || step.currentAttemptId !== attempt.attemptId) {
      throw new ConflictException('attempt_not_current');
    }
    return {
      cancelled:
        execution.status === ExecutionStatus.CANCELLED ||
        Boolean(execution.cancellationRequestedAt) ||
        step.status === ExecutionStepStatus.CANCELLED,
      leaseExpiresAt: attempt.leaseExpiresAt,
      deadline: step.deadline,
    };
  }

  async expireAttempt(attemptId: string, now = new Date()): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const attemptRepo = manager.getRepository(ExecutionStepAttemptEntity);
      const attempt = await attemptRepo.findOne({
        where: { attemptId },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !attempt ||
        attempt.leaseExpiresAt > now ||
        ![
          ExecutionStepAttemptStatus.LEASED,
          ExecutionStepAttemptStatus.RUNNING,
        ].includes(attempt.status)
      ) {
        return false;
      }
      const stepRepo = manager.getRepository(ExecutionStepEntity);
      const step = await stepRepo.findOne({
        where: { stepId: attempt.stepId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!step || step.currentAttemptId !== attempt.attemptId) return false;
      const operationRepo = manager.getRepository(ExecutionOperationEntity);
      const operation = await operationRepo.findOne({
        where: { operationId: step.operationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !operation ||
        operation.stepId !== step.stepId ||
        operation.currentAttemptId !== attempt.attemptId
      ) {
        throw new ConflictException('operation_attempt_mismatch');
      }

      assertAttemptTransition(
        attempt.status,
        ExecutionStepAttemptStatus.EXPIRED,
      );
      attempt.status = ExecutionStepAttemptStatus.EXPIRED;
      attempt.finishedAt = now;
      attempt.finishReason = 'lease_expired';
      step.currentAttemptId = null;
      step.version += 1;
      operation.currentAttemptId = null;
      const executionRepo = manager.getRepository(ExecutionEntity);
      const execution = await executionRepo.findOne({
        where: { executionId: step.executionId },
        lock: { mode: 'pessimistic_write' },
      });
      const cancellationRequested = Boolean(execution?.cancellationRequestedAt);
      const safelyReplayable = [
        ExecutionOperationRecoveryClass.READ_ONLY_REPLAYABLE,
        ExecutionOperationRecoveryClass.IDEMPOTENT,
      ].includes(operation.recoveryClass);
      if (cancellationRequested && safelyReplayable) {
        assertStepTransition(step.status, ExecutionStepStatus.CANCELLED);
        step.status = ExecutionStepStatus.CANCELLED;
        operation.status = ExecutionOperationStatus.CANCELLED;
        operation.finishedAt = now;
        execution!.phase = 'terminal_pending_cancelled';
        await executionRepo.save(execution!);
      } else if (safelyReplayable) {
        assertStepTransition(step.status, ExecutionStepStatus.READY);
        step.status = ExecutionStepStatus.READY;
        operation.status = ExecutionOperationStatus.PREPARED;
      } else {
        assertStepTransition(step.status, ExecutionStepStatus.FAILED);
        const error = {
          code: 'effect_unknown',
          message: 'The dispatched operation could not be recovered safely',
          attemptId: attempt.attemptId,
        };
        step.status = ExecutionStepStatus.FAILED;
        step.error = error;
        operation.status = ExecutionOperationStatus.UNKNOWN;
        operation.error = error;
        operation.finishedAt = now;
        if (execution && !this.isTerminalExecution(execution.status)) {
          execution.phase = 'terminal_pending_failed';
          execution.error = error;
          await executionRepo.save(execution);
        }
      }
      await attemptRepo.save(attempt);
      await stepRepo.save(step);
      await operationRepo.save(operation);
      return true;
    });
  }

  async expireStaleAttempts(now = new Date()): Promise<number> {
    const attempts = await this.dataSource
      .getRepository(ExecutionStepAttemptEntity)
      .find({
        where: {
          status: In([
            ExecutionStepAttemptStatus.LEASED,
            ExecutionStepAttemptStatus.RUNNING,
          ]),
          leaseExpiresAt: LessThanOrEqual(now),
        },
        order: { leaseExpiresAt: 'ASC' },
        take: 100,
      });
    let expired = 0;
    for (const attempt of attempts) {
      if (await this.expireAttempt(attempt.attemptId, now)) expired += 1;
    }
    return expired;
  }

  async receiveResult(
    input: ReceiveExecutionStepResultInput,
  ): Promise<StepResultReceiptAck> {
    this.contractValidator?.assertStepResult(input.result);
    const canonicalToolResult = toolResultFromStepResult(input.result);
    if (input.result.stepKind === ExecutionStepKind.TOOL) {
      if (!canonicalToolResult) {
        throw new BadRequestException('canonical_tool_result_required');
      }
      this.contractValidator?.assertToolResult(
        canonicalToolResult as unknown as Record<string, unknown>,
      );
      if (
        input.result.status !==
        expectedStepResultStatus(canonicalToolResult.status)
      ) {
        throw new BadRequestException('tool_result_status_mismatch');
      }
    }
    const hash = resultHash(input.result);
    const acknowledgedAt = new Date();
    const ack = (
      code: StepResultReceiptAck['code'],
      receiptId?: string,
    ): StepResultReceiptAck => ({
      schemaVersion: 'step-result-ack/1',
      executionId: input.executionId,
      stepId: input.stepId,
      operationId: input.operationId,
      attemptId: input.attemptId,
      code,
      ...(receiptId ? { receiptId } : {}),
      acknowledgedAt,
    });

    return this.dataSource.transaction(async (manager) => {
      const receiptRepo = manager.getRepository(ExecutionResultReceiptEntity);
      const existing = await receiptRepo.findOne({
        where: { attemptId: input.attemptId },
        lock: { mode: 'pessimistic_read' },
      });
      if (existing) {
        return existing.resultHash === hash
          ? ack('duplicate', existing.receiptId)
          : ack('result_conflict');
      }

      const attemptRepo = manager.getRepository(ExecutionStepAttemptEntity);
      const attempt = await attemptRepo.findOne({
        where: { attemptId: input.attemptId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!attempt) return ack('rejected');
      const stepRepo = manager.getRepository(ExecutionStepEntity);
      const step = await stepRepo.findOne({
        where: { stepId: input.stepId },
        lock: { mode: 'pessimistic_write' },
      });
      const operation = await manager
        .getRepository(ExecutionOperationEntity)
        .findOne({
          where: { operationId: input.operationId },
          lock: { mode: 'pessimistic_write' },
        });
      const toolPlan = canonicalToolResult
        ? await manager.getRepository(ExecutionToolPlanEntity).findOneBy({
            operationId: input.operationId,
          })
        : null;
      const toolIdentityMatches = canonicalToolResult
        ? toolPlan?.stepId === input.stepId &&
          toolPlan.toolCallId === canonicalToolResult.toolCallId &&
          canonicalToolResult.operationId === input.operationId
        : true;
      const identityMatches =
        attempt.executionId === input.executionId &&
        attempt.stepId === input.stepId &&
        attempt.operationId === input.operationId &&
        attempt.claimedBy === input.workerId &&
        input.result.stepKind === step?.stepKind &&
        operation?.executionId === input.executionId &&
        operation.stepId === input.stepId &&
        toolIdentityMatches;
      if (!identityMatches || !step || !operation) return ack('rejected');
      if (
        step.currentAttemptId !== attempt.attemptId ||
        operation.currentAttemptId !== attempt.attemptId ||
        operation.status !== ExecutionOperationStatus.DISPATCHED ||
        attempt.leaseExpiresAt <= acknowledgedAt ||
        ![
          ExecutionStepAttemptStatus.LEASED,
          ExecutionStepAttemptStatus.RUNNING,
        ].includes(attempt.status)
      ) {
        return ack('stale_attempt');
      }

      const outputArtifactRefs = await this.validateResultArtifactRefs(
        manager,
        input.attemptId,
        input.result['artifactRefs'],
      );

      assertAttemptTransition(
        attempt.status,
        ExecutionStepAttemptStatus.RESULT_RECEIVED,
      );
      assertStepTransition(step.status, ExecutionStepStatus.RESULT_RECEIVED);
      const receipt = receiptRepo.create({
        receiptId: randomUUID(),
        executionId: input.executionId,
        stepId: input.stepId,
        operationId: input.operationId,
        attemptId: input.attemptId,
        schemaVersion: 'step-result/1',
        resultHash: hash,
        result: input.result,
        receivedAt: acknowledgedAt,
      });
      await receiptRepo.save(receipt);
      attempt.status = ExecutionStepAttemptStatus.RESULT_RECEIVED;
      attempt.resultReceiptId = receipt.receiptId;
      step.status = ExecutionStepStatus.RESULT_RECEIVED;
      step.outputArtifactRefs = outputArtifactRefs;
      step.version += 1;
      await attemptRepo.save(attempt);
      await stepRepo.save(step);
      return ack('received', receipt.receiptId);
    });
  }

  private validateOutputArtifact(artifact: IncomingExecutionArtifact): Buffer {
    if (
      !artifact ||
      !UUID_PATTERN.test(String(artifact.artifactId ?? '')) ||
      typeof artifact.kind !== 'string' ||
      !artifact.kind.trim() ||
      artifact.kind.length > 80 ||
      !/^sha256:[0-9a-f]{64}$/.test(String(artifact.contentHash ?? '')) ||
      !Number.isInteger(artifact.size) ||
      artifact.size < 0 ||
      artifact.size > MAX_OUTPUT_ARTIFACT_BYTES ||
      artifact.mediaType !== 'application/json' ||
      typeof artifact.bodyBase64 !== 'string'
    ) {
      throw new BadRequestException('invalid_output_artifact');
    }
    const body = Buffer.from(artifact.bodyBase64, 'base64');
    if (
      body.toString('base64') !== artifact.bodyBase64 ||
      body.length !== artifact.size ||
      `sha256:${createHash('sha256').update(body).digest('hex')}` !==
        artifact.contentHash
    ) {
      throw new BadRequestException('output_artifact_integrity_mismatch');
    }
    return body;
  }

  private async validateResultArtifactRefs(
    manager: EntityManager,
    attemptId: string,
    value: unknown,
  ): Promise<ExecutionStepEntity['outputArtifactRefs']> {
    const refs = Array.isArray(value) ? value : [];
    if (refs.length > 100) {
      throw new BadRequestException('too_many_result_artifacts');
    }
    const normalized = refs.map((value) => {
      if (!value || typeof value !== 'object') {
        throw new BadRequestException('invalid_result_artifact_ref');
      }
      const ref = value as Record<string, unknown>;
      if (
        typeof ref.role !== 'string' ||
        !ref.role.trim() ||
        !UUID_PATTERN.test(String(ref.artifactId ?? '')) ||
        (ref.revision !== undefined &&
          (!Number.isInteger(ref.revision) || Number(ref.revision) < 1))
      ) {
        throw new BadRequestException('invalid_result_artifact_ref');
      }
      return {
        role: ref.role.trim(),
        artifactId: String(ref.artifactId),
        ...(ref.revision === undefined
          ? {}
          : { revision: Number(ref.revision) }),
      };
    });
    const ids = normalized.map((ref) => ref.artifactId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('duplicate_result_artifact_ref');
    }
    if (!ids.length) return normalized;
    const artifacts = await manager
      .getRepository(ExecutionArtifactEntity)
      .findBy({ artifactId: In(ids) });
    const ownedIds = new Set(
      artifacts
        .filter((artifact) => artifact.producedByAttemptId === attemptId)
        .map((artifact) => artifact.artifactId),
    );
    if (ids.some((id) => !ownedIds.has(id))) {
      throw new BadRequestException('result_artifact_not_owned_by_attempt');
    }
    return normalized;
  }

  async processReceivedResults(limit = 20): Promise<number> {
    let processed = 0;
    while (processed < limit) {
      const found = await this.dataSource.transaction(async (manager) => {
        const rows = await manager.query(`
          SELECT "step_id"
          FROM "execution_steps"
          WHERE "status" = 'result_received'
          ORDER BY "updated_at"
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `);
        if (!rows.length) return false;

        const stepRepo = manager.getRepository(ExecutionStepEntity);
        const step = await stepRepo.findOneBy({ stepId: rows[0].step_id });
        if (!step?.currentAttemptId) return false;
        const attemptRepo = manager.getRepository(ExecutionStepAttemptEntity);
        const attempt = await attemptRepo.findOneBy({
          attemptId: step.currentAttemptId,
        });
        const receipt = await manager
          .getRepository(ExecutionResultReceiptEntity)
          .findOne({
            where: { attemptId: step.currentAttemptId },
            order: { receivedAt: 'DESC' },
          });
        const executionRepo = manager.getRepository(ExecutionEntity);
        const execution = await executionRepo.findOne({
          where: { executionId: step.executionId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!attempt || !receipt || !execution) {
          throw new ConflictException('incomplete_result_receipt');
        }
        const operationRepo = manager.getRepository(ExecutionOperationEntity);
        const operation = await operationRepo.findOne({
          where: { operationId: step.operationId },
          lock: { mode: 'pessimistic_write' },
        });
        if (
          !operation ||
          operation.stepId !== step.stepId ||
          operation.currentAttemptId !== attempt.attemptId ||
          operation.status !== ExecutionOperationStatus.DISPATCHED
        ) {
          throw new ConflictException('operation_attempt_mismatch');
        }

        const result = receipt.result as Record<string, unknown>;
        const status = result.status;
        const canonicalToolResult = toolResultFromStepResult(result);
        const toolPlan = canonicalToolResult
          ? await manager.getRepository(ExecutionToolPlanEntity).findOneBy({
              operationId: operation.operationId,
            })
          : null;
        const acceptedStatus = canonicalToolResult?.status ?? status;
        const acceptedError = canonicalToolResult
          ? canonicalToolResult.error
          : (result.error as Record<string, unknown> | null | undefined);
        const executionWasTerminal = [
          ExecutionStatus.COMPLETED,
          ExecutionStatus.FAILED,
          ExecutionStatus.CANCELLED,
        ].includes(execution.status);
        const cancellationRequested = Boolean(
          execution.cancellationRequestedAt,
        );
        const executionHasTerminalIntent =
          executionWasTerminal ||
          cancellationRequested ||
          [
            'terminal_pending_failed',
            'terminal_pending_cancelled',
            'backend_failure_finalization',
            'domain_failure_finalization',
          ].includes(execution.phase ?? '');
        const finishedAt = new Date();
        if (['succeeded', 'not_executed'].includes(String(acceptedStatus))) {
          assertStepTransition(step.status, ExecutionStepStatus.COMPLETED);
          step.status = ExecutionStepStatus.COMPLETED;
          step.result = result.output ?? null;
          operation.status = canonicalToolResult
            ? operationStatusForToolResult(canonicalToolResult.status)
            : ExecutionOperationStatus.SUCCEEDED;
          operation.result = canonicalToolResult ?? result.output ?? null;
          operation.error = null;
        } else if (acceptedStatus === 'cancelled') {
          assertStepTransition(step.status, ExecutionStepStatus.CANCELLED);
          step.status = ExecutionStepStatus.CANCELLED;
          operation.status = ExecutionOperationStatus.CANCELLED;
          operation.result = canonicalToolResult;
          operation.error = acceptedError ?? null;
          if (!executionHasTerminalIntent) {
            execution.phase = 'terminal_pending_cancelled';
          }
        } else {
          assertStepTransition(step.status, ExecutionStepStatus.FAILED);
          step.status = ExecutionStepStatus.FAILED;
          step.error = acceptedError as Record<string, unknown>;
          operation.status = canonicalToolResult
            ? operationStatusForToolResult(canonicalToolResult.status)
            : ExecutionOperationStatus.FAILED;
          operation.result = canonicalToolResult;
          operation.error = acceptedError as Record<string, unknown>;
          if (!executionHasTerminalIntent) {
            execution.error = acceptedError;
            execution.phase = step.finalizeOnFailure
              ? 'backend_failure_finalization'
              : 'terminal_pending_failed';
          }
        }
        if (cancellationRequested && !executionWasTerminal) {
          if (
            ['succeeded', 'cancelled', 'not_executed'].includes(
              String(acceptedStatus),
            )
          ) {
            execution.phase = 'terminal_pending_cancelled';
          } else {
            execution.phase = 'terminal_pending_failed';
            execution.error = acceptedError ?? {
              code: 'operation_failed_during_cancellation',
              message: 'An operation failed while cancellation was pending',
            };
          }
        }
        assertAttemptTransition(
          attempt.status,
          ExecutionStepAttemptStatus.CLOSED,
        );
        attempt.status = ExecutionStepAttemptStatus.CLOSED;
        attempt.finishedAt = finishedAt;
        attempt.finishReason = String(acceptedStatus);
        operation.currentAttemptId = null;
        operation.finishedAt = finishedAt;
        step.version += 1;
        if (
          acceptedStatus === 'succeeded' &&
          canonicalToolResult &&
          toolPlan?.toolName === SKILL_RESOURCE_LOAD_TOOL_NAME
        ) {
          const loaded = canonicalToolResult.structuredContent as Record<
            string,
            unknown
          > | null;
          const planned = toolPlan.plan.normalizedArguments as Record<
            string,
            unknown
          >;
          if (
            loaded?.schemaVersion !== 'skill-resource/1' ||
            loaded.skillId !== planned.skillId ||
            loaded.skillVersion !== planned.skillVersion ||
            loaded.resourceId !== planned.resourceId ||
            loaded.contentHash !== planned.resourceContentHash
          ) {
            throw new ConflictException('skill_resource_result_mismatch');
          }
          await recordLoadedSkillResource(manager, execution.executionId, {
            skillId: String(planned.skillId),
            skillVersion: String(planned.skillVersion),
            skillContentHash: String(planned.skillContentHash),
            resourceId: String(planned.resourceId),
            resourceContentHash: String(planned.resourceContentHash),
            operationId: operation.operationId,
          });
        }
        await attemptRepo.save(attempt);
        await stepRepo.save(step);
        await operationRepo.save(operation);
        await this.appendOperationFinished(
          manager,
          execution,
          step,
          attempt,
          operation,
          canonicalToolResult,
          result,
          acceptedError ?? null,
        );
        if (acceptedStatus === 'succeeded' && !executionHasTerminalIntent) {
          await releaseExecutionStepDependents(manager, step.stepId);
          const remaining = await manager.query(
            `
              SELECT 1
              FROM "execution_steps"
              WHERE "execution_id" = $1
                AND "status" NOT IN ('completed', 'failed', 'cancelled')
              LIMIT 1
            `,
            [execution.executionId],
          );
          execution.status = ExecutionStatus.RUNNING;
          execution.phase = remaining.length ? null : 'backend_finalization';
          if (!remaining.length) {
            execution.result = executionStepOutputValue(
              result.output,
              execution.taskType,
            );
            execution.error = null;
          }
        }
        await executionRepo.save(execution);
        return true;
      });
      if (!found) break;
      processed += 1;
    }
    return processed;
  }

  private async lockCurrentAttempt(
    manager: EntityManager,
    attemptId: string,
    workerId: string,
  ): Promise<{
    attempt: ExecutionStepAttemptEntity;
    step: ExecutionStepEntity;
  }> {
    const attempt = await manager
      .getRepository(ExecutionStepAttemptEntity)
      .findOne({
        where: { attemptId },
        lock: { mode: 'pessimistic_write' },
      });
    if (!attempt) throw new NotFoundException('attempt_not_found');
    const step = await manager.getRepository(ExecutionStepEntity).findOne({
      where: { stepId: attempt.stepId },
      lock: { mode: 'pessimistic_write' },
    });
    if (
      !step ||
      attempt.claimedBy !== workerId ||
      step.currentAttemptId !== attempt.attemptId
    ) {
      throw new ConflictException('attempt_not_current');
    }
    return { attempt, step };
  }

  private async hasResourceConflict(
    manager: EntityManager,
    step: ExecutionStepEntity,
  ): Promise<boolean> {
    if (!step.resourceKeys.length) return false;
    const rows = await manager.query(
      `
        SELECT 1
        FROM "execution_steps"
        WHERE "status" = 'running'
          AND "step_id" <> $1
          AND "resource_keys" && $2::text[]
        LIMIT 1
      `,
      [step.stepId, step.resourceKeys],
    );
    return rows.length > 0;
  }

  private assertLeaseDuration(leaseDurationMs: number): void {
    if (
      !Number.isInteger(leaseDurationMs) ||
      leaseDurationMs < MIN_LEASE_MS ||
      leaseDurationMs > MAX_LEASE_MS
    ) {
      throw new BadRequestException('invalid_lease_duration');
    }
  }

  private async grantLockedAttempt(
    manager: EntityManager,
    step: ExecutionStepEntity,
    input: Pick<GrantExecutionStepAttemptInput, 'workerId' | 'leaseDurationMs'>,
  ): Promise<ExecutionStepAttemptEntity> {
    const now = new Date();
    if (step.status !== ExecutionStepStatus.READY) {
      throw new ConflictException('step_not_ready');
    }
    if (step.availableAt > now || (step.deadline && step.deadline <= now)) {
      throw new ConflictException('step_not_available');
    }
    const executionRepo = manager.getRepository(ExecutionEntity);
    const execution = await executionRepo.findOne({
      where: { executionId: step.executionId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!execution) throw new NotFoundException('execution_not_found');
    if (
      ![ExecutionStatus.QUEUED, ExecutionStatus.RUNNING].includes(
        execution.status,
      )
    ) {
      throw new ConflictException('execution_not_active');
    }
    if (execution.cancellationRequestedAt) {
      throw new ConflictException('execution_cancellation_requested');
    }
    if (
      step.stepKind === ExecutionStepKind.INFERENCE &&
      ['assistant-chat', 'agent-chat', 'delegated-agent'].includes(
        execution.taskType,
      ) &&
      !['context-input-map', 'context-input-reduce'].includes(
        String(step.work?.taskType ?? ''),
      ) &&
      !step.budgetReservationId
    ) {
      throw new ConflictException('operation_budget_not_reserved');
    }
    await this.lockResourceKeys(manager, step.resourceKeys);
    if (await this.hasResourceConflict(manager, step)) {
      throw new ConflictException('resource_conflict');
    }

    assertStepTransition(step.status, ExecutionStepStatus.RUNNING);
    const attemptRepo = manager.getRepository(ExecutionStepAttemptEntity);
    const requestedLeaseExpiry = new Date(
      now.getTime() + input.leaseDurationMs,
    );
    const attempt = attemptRepo.create({
      attemptId: randomUUID(),
      executionId: step.executionId,
      stepId: step.stepId,
      operationId: step.operationId,
      schemaVersion: 'step-attempt/1',
      claimedBy: input.workerId,
      status: ExecutionStepAttemptStatus.LEASED,
      leaseGrantedAt: now,
      leaseExpiresAt:
        step.deadline && step.deadline < requestedLeaseExpiry
          ? step.deadline
          : requestedLeaseExpiry,
      heartbeatAt: null,
      startedAt: null,
      finishedAt: null,
      finishReason: null,
      resultReceiptId: null,
    });
    await attemptRepo.save(attempt);
    const operationRepo = manager.getRepository(ExecutionOperationEntity);
    const operation = await operationRepo.findOne({
      where: { operationId: step.operationId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!operation || operation.stepId !== step.stepId) {
      throw new ConflictException('operation_not_found');
    }
    if (
      ![
        ExecutionOperationStatus.PLANNED,
        ExecutionOperationStatus.PREPARED,
      ].includes(operation.status)
    ) {
      throw new ConflictException('operation_not_dispatchable');
    }
    operation.status = ExecutionOperationStatus.DISPATCHED;
    operation.currentAttemptId = attempt.attemptId;
    operation.finishedAt = null;
    operation.error = null;
    await operationRepo.save(operation);
    step.status = ExecutionStepStatus.RUNNING;
    step.currentAttemptId = attempt.attemptId;
    step.version += 1;
    await manager.getRepository(ExecutionStepEntity).save(step);
    if (execution.status === ExecutionStatus.QUEUED) {
      execution.status = ExecutionStatus.RUNNING;
    }
    await this.appendOperationStarted(
      manager,
      execution,
      step,
      attempt,
      operation,
    );
    await executionRepo.save(execution);
    return attempt;
  }

  private async appendOperationStarted(
    manager: EntityManager,
    execution: ExecutionEntity,
    step: ExecutionStepEntity,
    attempt: ExecutionStepAttemptEntity,
    operation: ExecutionOperationEntity,
  ): Promise<void> {
    const eventRoot = await this.lockEventRoot(manager, execution);
    const eventRepo = manager.getRepository(ExecutionEventEntity);
    const rows = await eventRepo.find({
      where: { rootExecutionId: execution.rootExecutionId },
      order: { sequence: 'ASC' },
    });
    const work = (step.work ?? {}) as Record<string, unknown>;
    const plan = work.toolPlan as Record<string, unknown> | undefined;
    const operationKind =
      operation.operationKind ?? operationKindForStep(step.stepKind);
    const projected = projectExecutionProgress(
      rows.map((row) => row.envelope as unknown as ProgressEvent),
    );
    const budgetPayload = this.operationBudgetStartPayload(
      execution,
      step,
      operation,
      operationKind,
      projected.ledger,
      work,
    );
    const event = await appendBackendExecutionEvent(
      manager,
      eventRoot,
      nextBackendProducerSequence(rows),
      {
        eventType: 'operation.started',
        payloadSchema: 'operation.started/1',
        payload: {
          operationKind,
          status: 'dispatched',
          name: String(work.taskType ?? operationKind),
          ...budgetPayload,
        },
        actor: { type: 'system' },
        executionId: execution.executionId,
        turnId: execution.turnId,
        stepId: step.stepId,
        operationId: operation.operationId,
        toolCallId:
          typeof plan?.toolCallId === 'string' ? plan.toolCallId : null,
        attemptId: attempt.attemptId,
        causedByEventId: operation.causedByEventId,
        artifactRefs: [],
      },
    );
    this.contractValidator?.assertEvent(event.envelope);
    this.applyProgressProjection(execution, [...rows, event]);
    execution.lastSequence = event.sequence;
    execution.lastEventId = event.eventId;
    if (eventRoot.executionId !== execution.executionId) {
      eventRoot.lastSequence = event.sequence;
      eventRoot.lastEventId = event.eventId;
      await manager.getRepository(ExecutionEntity).save(eventRoot);
    }
  }

  private operationBudgetStartPayload(
    execution: ExecutionEntity,
    step: ExecutionStepEntity,
    operation: ExecutionOperationEntity,
    operationKind: ExecutionOperationKind,
    ledger: ReturnType<typeof projectExecutionProgress>['ledger'],
    work: Record<string, unknown>,
  ): Record<string, unknown> {
    if (!step.budgetReservationId) return {};
    const reservation =
      ledger.operationBudget?.reservations[operation.operationId];
    if (
      !reservation ||
      reservation.reservationId !== step.budgetReservationId ||
      reservation.status !== 'reserved' ||
      reservation.operationKind !== operationKind
    ) {
      throw new ConflictException('operation_budget_not_reserved');
    }
    const grant = ledger.operationBudget?.grants[reservation.grantId];
    if (!grant) throw new ConflictException('operation_budget_grant_not_found');
    const guard = ledger.loopGuards?.[reservation.grantId]?.exactToolRepeat;
    const isNormalInference =
      operationKind === ExecutionOperationKind.INFERENCE &&
      reservation.bucket === 'normal';
    const maxRounds = Math.max(
      reservation.round,
      grant.effectivePolicy.normal +
        grant.effectivePolicy.repair +
        grant.effectivePolicy.closing,
    );
    return {
      loopId: grant.loopId,
      agentName: String(
        work.agentName ??
          (execution.taskType === 'agent-chat' ? 'agent' : 'assistant'),
      ),
      loopKind: execution.parentExecutionId
        ? 'synchronous_subagent'
        : 'top_level',
      round: reservation.round,
      maxRounds,
      phase: reservation.phase,
      budgetGrantId: reservation.grantId,
      budgetReservationId: reservation.reservationId,
      budgetBucket: reservation.bucket,
      ...(isNormalInference &&
      grant.usage.normal.softLimitWarningPending === true
        ? { budgetSoftLimitWarningApplied: true }
        : {}),
      ...(reservation.operationFingerprint
        ? {
            operationFingerprint: reservation.operationFingerprint,
            operationFingerprintVersion:
              reservation.operationFingerprintVersion,
          }
        : {}),
      ...(reservation.toolBatchSize !== undefined
        ? {
            toolBatchSize: reservation.toolBatchSize,
            toolBatchIndex: reservation.toolBatchIndex,
          }
        : {}),
      ...(isNormalInference && guard?.warningPending === true
        ? { loopGuardWarningApplied: true }
        : {}),
      ...(isNormalInference && guard?.blockResultPending === true
        ? { loopGuardBlockResultApplied: true }
        : {}),
    };
  }

  private async appendOperationFinished(
    manager: EntityManager,
    execution: ExecutionEntity,
    step: ExecutionStepEntity,
    attempt: ExecutionStepAttemptEntity,
    operation: ExecutionOperationEntity,
    toolResult: ToolResultContract | null,
    stepResult: Record<string, unknown>,
    error: Record<string, unknown> | null,
  ): Promise<void> {
    const eventRoot = await this.lockEventRoot(manager, execution);
    const eventRepo = manager.getRepository(ExecutionEventEntity);
    const rows = await eventRepo.find({
      where: { rootExecutionId: execution.rootExecutionId },
      order: { sequence: 'ASC' },
    });
    const started = rows.find(
      (row) =>
        row.eventType === 'operation.started' &&
        row.operationId === operation.operationId &&
        row.attemptId === attempt.attemptId,
    );
    if (!started) throw new ConflictException('operation_start_not_found');
    const operationKind =
      operation.operationKind ?? operationKindForStep(step.stepKind);
    const output = stepResult.output as Record<string, unknown> | undefined;
    const outcome = output?.outcome as Record<string, unknown> | undefined;
    const eventStatus =
      operation.status === ExecutionOperationStatus.NOT_EXECUTED
        ? ExecutionOperationStatus.FAILED
        : operation.status;
    const event = await appendBackendExecutionEvent(
      manager,
      eventRoot,
      nextBackendProducerSequence(rows),
      {
        eventType: 'operation.finished',
        payloadSchema: 'operation.finished/1',
        payload: {
          operationKind,
          status: eventStatus,
          ...(operationKind === ExecutionOperationKind.INFERENCE
            ? { outcome: String(outcome?.kind ?? 'invalid') }
            : {}),
          result: toolResult ?? output ?? null,
          error,
        },
        actor: { type: 'system' },
        executionId: execution.executionId,
        turnId: execution.turnId,
        stepId: step.stepId,
        operationId: operation.operationId,
        toolCallId: toolResult?.toolCallId ?? null,
        attemptId: attempt.attemptId,
        causedByEventId: started.eventId,
        artifactRefs: step.outputArtifactRefs.map((ref) => ref.artifactId),
      },
    );
    this.contractValidator?.assertEvent(event.envelope);
    this.applyProgressProjection(execution, [...rows, event]);
    execution.lastSequence = event.sequence;
    execution.lastEventId = event.eventId;
    if (eventRoot.executionId !== execution.executionId) {
      eventRoot.lastSequence = event.sequence;
      eventRoot.lastEventId = event.eventId;
      await manager.getRepository(ExecutionEntity).save(eventRoot);
    }
  }

  private async lockEventRoot(
    manager: EntityManager,
    execution: ExecutionEntity,
  ): Promise<ExecutionEntity> {
    if (execution.rootExecutionId === execution.executionId) return execution;
    const root = await manager.getRepository(ExecutionEntity).findOne({
      where: {
        executionId: execution.rootExecutionId,
        rootExecutionId: execution.rootExecutionId,
      },
      lock: { mode: 'pessimistic_write' },
    });
    if (!root) throw new NotFoundException('root_execution_not_found');
    return root;
  }

  private applyProgressProjection(
    execution: ExecutionEntity,
    rows: ExecutionEventEntity[],
  ): void {
    const progress = projectExecutionProgress(
      rows.map((row) => row.envelope as unknown as ProgressEvent),
    );
    execution.progressPolicy = progress.policy;
    execution.progressLedger = progress.ledger;
  }

  private isTerminalExecution(status: ExecutionStatus): boolean {
    return [
      ExecutionStatus.COMPLETED,
      ExecutionStatus.FAILED,
      ExecutionStatus.CANCELLED,
    ].includes(status);
  }

  private async lockResourceKeys(
    manager: EntityManager,
    resourceKeys: string[],
  ): Promise<void> {
    for (const resourceKey of [...new Set(resourceKeys)].sort()) {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [resourceKey],
      );
    }
  }
}

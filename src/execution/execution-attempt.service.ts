import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import {
  ClaimExecutionStepInput,
  GrantExecutionStepAttemptInput,
  ReceiveExecutionStepResultInput,
  StepAssignment,
  StepResultReceiptAck,
} from './execution-control-plane.types';
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

const MIN_LEASE_MS = 1_000;
const MAX_LEASE_MS = 15 * 60 * 1_000;

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  }
  if (typeof value === 'number' && !Number.isInteger(value)) {
    throw new BadRequestException('invalid_step_result');
  }
  return value;
}

function resultHash(result: Record<string, unknown>): string {
  const canonical = JSON.stringify(canonicalValue(result));
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

@Injectable()
export class ExecutionAttemptService {
  constructor(private readonly dataSource: DataSource) {}

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
      const rows = await manager.query(
        `
          SELECT "step_id"
          FROM "execution_steps"
          WHERE "status" = 'ready'
            AND "available_at" <= now()
            AND ("deadline" IS NULL OR "deadline" > now())
            AND "step_kind" = ANY($1::text[])
            AND "required_capabilities" <@ $2::text[]
          ORDER BY "priority" DESC, "available_at", "created_at"
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `,
        [stepKinds, capabilities],
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
      return {
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
        deadline:
          step.deadline && step.deadline < attempt.leaseExpiresAt
            ? step.deadline
            : attempt.leaseExpiresAt,
      };
    });
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

      assertAttemptTransition(
        attempt.status,
        ExecutionStepAttemptStatus.EXPIRED,
      );
      assertStepTransition(step.status, ExecutionStepStatus.READY);
      attempt.status = ExecutionStepAttemptStatus.EXPIRED;
      attempt.finishedAt = now;
      attempt.finishReason = 'lease_expired';
      step.status = ExecutionStepStatus.READY;
      step.currentAttemptId = null;
      step.version += 1;
      await attemptRepo.save(attempt);
      await stepRepo.save(step);
      return true;
    });
  }

  async receiveResult(
    input: ReceiveExecutionStepResultInput,
  ): Promise<StepResultReceiptAck> {
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
      const identityMatches =
        attempt.executionId === input.executionId &&
        attempt.stepId === input.stepId &&
        attempt.operationId === input.operationId &&
        attempt.claimedBy === input.workerId;
      if (!identityMatches || !step) return ack('rejected');
      if (
        step.currentAttemptId !== attempt.attemptId ||
        attempt.leaseExpiresAt <= acknowledgedAt ||
        ![
          ExecutionStepAttemptStatus.LEASED,
          ExecutionStepAttemptStatus.RUNNING,
        ].includes(attempt.status)
      ) {
        return ack('stale_attempt');
      }

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
      step.version += 1;
      await attemptRepo.save(attempt);
      await stepRepo.save(step);
      return ack('received', receipt.receiptId);
    });
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
    await this.lockResourceKeys(manager, step.resourceKeys);
    if (await this.hasResourceConflict(manager, step)) {
      throw new ConflictException('resource_conflict');
    }

    assertStepTransition(step.status, ExecutionStepStatus.RUNNING);
    const attemptRepo = manager.getRepository(ExecutionStepAttemptEntity);
    const attempt = attemptRepo.create({
      attemptId: randomUUID(),
      executionId: step.executionId,
      stepId: step.stepId,
      operationId: step.operationId,
      schemaVersion: 'step-attempt/1',
      claimedBy: input.workerId,
      status: ExecutionStepAttemptStatus.LEASED,
      leaseGrantedAt: now,
      leaseExpiresAt: new Date(now.getTime() + input.leaseDurationMs),
      heartbeatAt: null,
      startedAt: null,
      finishedAt: null,
      finishReason: null,
      resultReceiptId: null,
    });
    await attemptRepo.save(attempt);
    step.status = ExecutionStepStatus.RUNNING;
    step.currentAttemptId = attempt.attemptId;
    step.version += 1;
    await manager.getRepository(ExecutionStepEntity).save(step);
    return attempt;
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

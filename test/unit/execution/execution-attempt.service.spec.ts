import { ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
import { ExecutionAttemptService } from '../../../src/execution/execution-attempt.service';
import { ExecutionResultReceiptEntity } from '../../../src/execution/execution-result-receipt.entity';
import { ExecutionStepAttemptStatus } from '../../../src/execution/execution-step-attempt-status.enum';
import { ExecutionStepAttemptEntity } from '../../../src/execution/execution-step-attempt.entity';
import { ExecutionStepDependencyEntity } from '../../../src/execution/execution-step-dependency.entity';
import { ExecutionStepKind } from '../../../src/execution/execution-step-kind.enum';
import { ExecutionStepStatus } from '../../../src/execution/execution-step-status.enum';
import { ExecutionStepEntity } from '../../../src/execution/execution-step.entity';
import { ExecutionEntity } from '../../../src/execution/execution.entity';
import { ExecutionStatus } from '../../../src/execution/execution-status.enum';

const EXECUTION_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca701';
const STEP_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca702';
const OPERATION_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca703';
const ATTEMPT_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca704';
const WORKER_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca705';

describe('ExecutionAttemptService', () => {
  let service: ExecutionAttemptService;
  let stepRepo: Record<string, jest.Mock>;
  let attemptRepo: Record<string, jest.Mock>;
  let receiptRepo: Record<string, jest.Mock>;
  let dependencyRepo: Record<string, jest.Mock>;
  let executionRepo: Record<string, jest.Mock>;
  let manager: Record<string, jest.Mock>;

  const readyStep = () => ({
    stepId: STEP_ID,
    executionId: EXECUTION_ID,
    operationId: OPERATION_ID,
    status: ExecutionStepStatus.READY,
    version: 1,
    currentAttemptId: null,
    resourceKeys: [],
    availableAt: new Date(Date.now() - 1_000),
    deadline: new Date(Date.now() + 60_000),
  });

  const runningAttempt = () => ({
    attemptId: ATTEMPT_ID,
    executionId: EXECUTION_ID,
    stepId: STEP_ID,
    operationId: OPERATION_ID,
    claimedBy: WORKER_ID,
    status: ExecutionStepAttemptStatus.RUNNING,
    leaseExpiresAt: new Date(Date.now() + 60_000),
    resultReceiptId: null,
  });

  beforeEach(() => {
    stepRepo = {
      findOne: jest.fn(),
      findOneBy: jest.fn(),
      save: jest.fn(async (value) => value),
    };
    attemptRepo = {
      findOne: jest.fn(),
      findOneBy: jest.fn(),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    receiptRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    dependencyRepo = {
      findBy: jest.fn().mockResolvedValue([]),
    };
    executionRepo = {
      findOne: jest.fn().mockResolvedValue({
        executionId: EXECUTION_ID,
        status: ExecutionStatus.QUEUED,
      }),
      findOneBy: jest.fn(),
      save: jest.fn(async (value) => value),
    };
    manager = {
      getRepository: jest.fn((entity) => {
        if (entity === ExecutionStepEntity) return stepRepo;
        if (entity === ExecutionStepAttemptEntity) return attemptRepo;
        if (entity === ExecutionResultReceiptEntity) return receiptRepo;
        if (entity === ExecutionStepDependencyEntity) return dependencyRepo;
        if (entity === ExecutionEntity) return executionRepo;
        throw new Error(`Unexpected repository ${entity.name}`);
      }),
      query: jest.fn().mockResolvedValue([]),
    };
    service = new ExecutionAttemptService({
      transaction: jest.fn(async (callback) => callback(manager)),
    } as any);
  });

  it('grants a fenced lease and marks the step running atomically', async () => {
    const step = readyStep();
    stepRepo.findOne.mockResolvedValue(step);

    const attempt = await service.grantAttempt({
      stepId: STEP_ID,
      workerId: WORKER_ID,
      leaseDurationMs: 30_000,
    });

    expect(attempt).toEqual(
      expect.objectContaining({
        executionId: EXECUTION_ID,
        stepId: STEP_ID,
        operationId: OPERATION_ID,
        claimedBy: WORKER_ID,
        status: ExecutionStepAttemptStatus.LEASED,
      }),
    );
    expect(step.status).toBe(ExecutionStepStatus.RUNNING);
    expect(step.currentAttemptId).toBe(attempt.attemptId);
    expect(attemptRepo.save.mock.invocationCallOrder[0]).toBeLessThan(
      stepRepo.save.mock.invocationCallOrder[0],
    );
    expect(executionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: ExecutionStatus.RUNNING }),
    );
  });

  it('claims the highest compatible ready step as an assignment', async () => {
    const step = {
      ...readyStep(),
      stepKind: ExecutionStepKind.SERVICE,
      inputArtifactRefs: [],
      work: { taskType: 'detect-language' },
    };
    manager.query
      .mockResolvedValueOnce([{ step_id: STEP_ID }])
      .mockResolvedValueOnce([]);
    stepRepo.findOneBy.mockResolvedValue(step);

    const assignment = await service.claimReadyStep({
      workerId: WORKER_ID,
      stepKinds: [ExecutionStepKind.SERVICE],
      capabilities: ['detect-language'],
      leaseDurationMs: 30_000,
    });

    expect(assignment).toEqual(
      expect.objectContaining({
        schemaVersion: 'step-assignment/1',
        executionId: EXECUTION_ID,
        stepId: STEP_ID,
        operationId: OPERATION_ID,
        stepKind: ExecutionStepKind.SERVICE,
        work: { taskType: 'detect-language' },
      }),
    );
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE SKIP LOCKED'),
      [[ExecutionStepKind.SERVICE], ['detect-language']],
    );
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining(`"executions"."status" IN ('queued', 'running')`),
      [[ExecutionStepKind.SERVICE], ['detect-language']],
    );
  });

  it('does not grant work for a terminal execution', async () => {
    const step = readyStep();
    stepRepo.findOne.mockResolvedValue(step);
    executionRepo.findOne.mockResolvedValue({
      executionId: EXECUTION_ID,
      status: ExecutionStatus.CANCELLED,
    });

    await expect(
      service.grantAttempt({
        stepId: STEP_ID,
        workerId: WORKER_ID,
        leaseDurationMs: 30_000,
      }),
    ).rejects.toThrow('execution_not_active');
    expect(attemptRepo.save).not.toHaveBeenCalled();
  });

  it('rejects a claim while an incompatible resource is active', async () => {
    const step = { ...readyStep(), resourceKeys: ['resource:42'] };
    stepRepo.findOne.mockResolvedValue(step);
    manager.query.mockResolvedValue([{ conflict: 1 }]);

    await expect(
      service.grantAttempt({
        stepId: STEP_ID,
        workerId: WORKER_ID,
        leaseDurationMs: 30_000,
      }),
    ).rejects.toThrow('resource_conflict');
    expect(attemptRepo.save).not.toHaveBeenCalled();
  });

  it('fences an expired attempt and returns the step to ready', async () => {
    const attempt = {
      ...runningAttempt(),
      leaseExpiresAt: new Date(Date.now() - 1_000),
    };
    const step = {
      ...readyStep(),
      status: ExecutionStepStatus.RUNNING,
      currentAttemptId: ATTEMPT_ID,
    };
    attemptRepo.findOne.mockResolvedValue(attempt);
    stepRepo.findOne.mockResolvedValue(step);

    await expect(service.expireAttempt(ATTEMPT_ID)).resolves.toBe(true);
    expect(attempt.status).toBe(ExecutionStepAttemptStatus.EXPIRED);
    expect(step.status).toBe(ExecutionStepStatus.READY);
    expect(step.currentAttemptId).toBeNull();
  });

  it('stores a result before semantic processing and returns received', async () => {
    const attempt = runningAttempt();
    const step = {
      ...readyStep(),
      status: ExecutionStepStatus.RUNNING,
      currentAttemptId: ATTEMPT_ID,
    };
    attemptRepo.findOne.mockResolvedValue(attempt);
    stepRepo.findOne.mockResolvedValue(step);

    const ack = await service.receiveResult({
      executionId: EXECUTION_ID,
      stepId: STEP_ID,
      operationId: OPERATION_ID,
      attemptId: ATTEMPT_ID,
      workerId: WORKER_ID,
      result: { status: 'succeeded' },
    });

    expect(ack.code).toBe('received');
    expect(ack.receiptId).toEqual(expect.any(String));
    expect(attempt.status).toBe(ExecutionStepAttemptStatus.RESULT_RECEIVED);
    expect(step.status).toBe(ExecutionStepStatus.RESULT_RECEIVED);
    expect(receiptRepo.save).toHaveBeenCalledTimes(1);
  });

  it('releases dependents without finalizing while work remains', async () => {
    const step = {
      ...readyStep(),
      status: ExecutionStepStatus.RESULT_RECEIVED,
      currentAttemptId: ATTEMPT_ID,
    };
    const attempt = {
      ...runningAttempt(),
      status: ExecutionStepAttemptStatus.RESULT_RECEIVED,
    };
    const execution = {
      executionId: EXECUTION_ID,
      status: ExecutionStatus.RUNNING,
      phase: null,
      result: null,
    };
    manager.query
      .mockResolvedValueOnce([{ step_id: STEP_ID }])
      .mockResolvedValueOnce([{ step_id: 'dependent-step' }])
      .mockResolvedValueOnce([{ pending: 1 }])
      .mockResolvedValueOnce([]);
    stepRepo.findOneBy.mockResolvedValue(step);
    attemptRepo.findOneBy.mockResolvedValue(attempt);
    receiptRepo.findOne.mockResolvedValue({
      result: { status: 'succeeded', output: { value: 42 } },
    });
    executionRepo.findOne.mockResolvedValue(execution);

    await expect(service.processReceivedResults()).resolves.toBe(1);
    expect(step.status).toBe(ExecutionStepStatus.COMPLETED);
    expect(execution).toEqual(
      expect.objectContaining({
        status: ExecutionStatus.RUNNING,
        phase: null,
        result: null,
      }),
    );
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('unresolved_dependency'),
      [STEP_ID],
    );
  });

  it('offers domain finalization only after the last step completes', async () => {
    const step = {
      ...readyStep(),
      status: ExecutionStepStatus.RESULT_RECEIVED,
      currentAttemptId: ATTEMPT_ID,
    };
    const attempt = {
      ...runningAttempt(),
      status: ExecutionStepAttemptStatus.RESULT_RECEIVED,
    };
    const execution = {
      executionId: EXECUTION_ID,
      status: ExecutionStatus.RUNNING,
      phase: null,
      result: null,
      error: { code: 'OLD_ERROR' },
    };
    manager.query
      .mockResolvedValueOnce([{ step_id: STEP_ID }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    stepRepo.findOneBy.mockResolvedValue(step);
    attemptRepo.findOneBy.mockResolvedValue(attempt);
    receiptRepo.findOne.mockResolvedValue({
      result: { status: 'succeeded', output: { value: 42 } },
    });
    executionRepo.findOne.mockResolvedValue(execution);

    await expect(service.processReceivedResults()).resolves.toBe(1);
    expect(execution).toEqual(
      expect.objectContaining({
        status: ExecutionStatus.RUNNING,
        phase: 'backend_finalization',
        result: 42,
        error: null,
      }),
    );
  });

  it('does not revive an execution when a parallel result arrives late', async () => {
    const step = {
      ...readyStep(),
      status: ExecutionStepStatus.RESULT_RECEIVED,
      currentAttemptId: ATTEMPT_ID,
    };
    const attempt = {
      ...runningAttempt(),
      status: ExecutionStepAttemptStatus.RESULT_RECEIVED,
    };
    const execution = {
      executionId: EXECUTION_ID,
      status: ExecutionStatus.FAILED,
      phase: null,
      result: null,
      error: { code: 'WORKER_FAILED' },
    };
    manager.query
      .mockResolvedValueOnce([{ step_id: STEP_ID }])
      .mockResolvedValueOnce([]);
    stepRepo.findOneBy.mockResolvedValue(step);
    attemptRepo.findOneBy.mockResolvedValue(attempt);
    receiptRepo.findOne.mockResolvedValue({
      result: { status: 'succeeded', output: { value: 42 } },
    });
    executionRepo.findOne.mockResolvedValue(execution);

    await expect(service.processReceivedResults()).resolves.toBe(1);
    expect(execution).toEqual(
      expect.objectContaining({
        status: ExecutionStatus.FAILED,
        phase: null,
        result: null,
        error: { code: 'WORKER_FAILED' },
      }),
    );
  });

  it('returns the original receipt for an identical retry', async () => {
    const hash = `sha256:${createHash('sha256')
      .update('{"status":"succeeded"}')
      .digest('hex')}`;
    receiptRepo.findOne.mockResolvedValue({
      receiptId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca706',
      resultHash: hash,
    });

    const ack = await service.receiveResult({
      executionId: EXECUTION_ID,
      stepId: STEP_ID,
      operationId: OPERATION_ID,
      attemptId: ATTEMPT_ID,
      workerId: WORKER_ID,
      result: { status: 'succeeded' },
    });

    expect(ack).toEqual(
      expect.objectContaining({
        code: 'duplicate',
        receiptId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca706',
      }),
    );
    expect(attemptRepo.findOne).not.toHaveBeenCalled();
  });

  it('rejects a late result without mutating the current step', async () => {
    const attempt = runningAttempt();
    const step = {
      ...readyStep(),
      status: ExecutionStepStatus.RUNNING,
      currentAttemptId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca799',
    };
    attemptRepo.findOne.mockResolvedValue(attempt);
    stepRepo.findOne.mockResolvedValue(step);

    const ack = await service.receiveResult({
      executionId: EXECUTION_ID,
      stepId: STEP_ID,
      operationId: OPERATION_ID,
      attemptId: ATTEMPT_ID,
      workerId: WORKER_ID,
      result: { status: 'succeeded' },
    });

    expect(ack.code).toBe('stale_attempt');
    expect(stepRepo.save).not.toHaveBeenCalled();
  });

  it('rejects starting an attempt that is no longer current', async () => {
    attemptRepo.findOne.mockResolvedValue(runningAttempt());
    stepRepo.findOne.mockResolvedValue({
      ...readyStep(),
      status: ExecutionStepStatus.RUNNING,
      currentAttemptId: null,
    });

    await expect(service.startAttempt(ATTEMPT_ID, WORKER_ID)).rejects.toThrow(
      ConflictException,
    );
  });
});

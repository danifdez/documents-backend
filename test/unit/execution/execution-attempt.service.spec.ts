import { BadRequestException, ConflictException } from '@nestjs/common';
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
import { ExecutionOperationEntity } from '../../../src/execution/execution-operation.entity';
import { ExecutionOperationRecoveryClass } from '../../../src/execution/execution-operation-recovery-class.enum';
import { ExecutionOperationStatus } from '../../../src/execution/execution-operation-status.enum';
import { ExecutionToolPlanEntity } from '../../../src/execution/execution-tool-plan.entity';
import { ExecutionEventEntity } from '../../../src/execution/execution-event.entity';
import { ExecutionOperationKind } from '../../../src/execution/execution-operation-kind.enum';
import { ExecutionArtifactEntity } from '../../../src/execution/execution-artifact.entity';
import { WorkerEntity } from '../../../src/worker/worker.entity';
import { WorkerKind } from '../../../src/worker/worker-kind.enum';

const EXECUTION_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca701';
const STEP_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca702';
const OPERATION_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca703';
const ATTEMPT_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca704';
const WORKER_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca705';
const TOOL_CALL_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca706';
const ARTIFACT_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca709';

describe('ExecutionAttemptService', () => {
  let service: ExecutionAttemptService;
  let stepRepo: Record<string, jest.Mock>;
  let attemptRepo: Record<string, jest.Mock>;
  let receiptRepo: Record<string, jest.Mock>;
  let dependencyRepo: Record<string, jest.Mock>;
  let executionRepo: Record<string, jest.Mock>;
  let operationRepo: Record<string, jest.Mock>;
  let toolPlanRepo: Record<string, jest.Mock>;
  let eventRepo: Record<string, jest.Mock>;
  let artifactRepo: Record<string, jest.Mock>;
  let workerRepo: Record<string, jest.Mock>;
  let manager: Record<string, jest.Mock>;

  const readyStep = () => ({
    stepId: STEP_ID,
    executionId: EXECUTION_ID,
    operationId: OPERATION_ID,
    status: ExecutionStepStatus.READY,
    version: 1,
    currentAttemptId: null,
    stepKind: ExecutionStepKind.SERVICE,
    outputArtifactRefs: [],
    work: { taskType: 'detect-language' },
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

  const dispatchedOperation = () => ({
    operationId: OPERATION_ID,
    executionId: EXECUTION_ID,
    stepId: STEP_ID,
    status: ExecutionOperationStatus.DISPATCHED,
    recoveryClass: ExecutionOperationRecoveryClass.READ_ONLY_REPLAYABLE,
    currentAttemptId: ATTEMPT_ID,
    operationKind: ExecutionOperationKind.ARTIFACT_PROCESSING,
    causedByEventId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca707',
    error: null,
    finishedAt: null,
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
      count: jest.fn().mockResolvedValue(0),
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
        rootExecutionId: EXECUTION_ID,
        turnId: null,
        lastSequence: '1',
        lastEventId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca707',
        status: ExecutionStatus.QUEUED,
      }),
      findOneBy: jest.fn(),
      save: jest.fn(async (value) => value),
    };
    operationRepo = {
      findOne: jest.fn().mockResolvedValue({
        ...dispatchedOperation(),
        status: ExecutionOperationStatus.PREPARED,
        currentAttemptId: null,
      }),
      findOneBy: jest.fn().mockImplementation(async ({ operationId }) => ({
        operationId,
        status: ExecutionOperationStatus.PLANNED,
      })),
      save: jest.fn(async (value) => value),
    };
    toolPlanRepo = {
      findOneBy: jest.fn().mockResolvedValue({
        operationId: OPERATION_ID,
        stepId: STEP_ID,
        toolCallId: TOOL_CALL_ID,
      }),
    };
    eventRepo = {
      find: jest.fn().mockResolvedValue([
        {
          eventId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca708',
          rootExecutionId: EXECUTION_ID,
          sequence: '1',
          producerComponent: 'documents-backend',
          producerSequence: '1',
          eventType: 'operation.started',
          operationId: OPERATION_ID,
          attemptId: ATTEMPT_ID,
          envelope: {
            sequence: 1,
            eventType: 'operation.started',
            operationId: OPERATION_ID,
            attemptId: ATTEMPT_ID,
            payload: {
              operationKind: 'artifact_processing',
              status: 'dispatched',
              name: 'detect-language',
            },
          },
        },
      ]),
      create: jest.fn((value) => value),
    };
    artifactRepo = {
      findOneBy: jest.fn().mockResolvedValue(null),
      findBy: jest.fn().mockResolvedValue([]),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    workerRepo = {
      findOne: jest.fn(),
    };
    manager = {
      getRepository: jest.fn((entity) => {
        if (entity === ExecutionStepEntity) return stepRepo;
        if (entity === ExecutionStepAttemptEntity) return attemptRepo;
        if (entity === ExecutionResultReceiptEntity) return receiptRepo;
        if (entity === ExecutionStepDependencyEntity) return dependencyRepo;
        if (entity === ExecutionEntity) return executionRepo;
        if (entity === ExecutionOperationEntity) return operationRepo;
        if (entity === ExecutionToolPlanEntity) return toolPlanRepo;
        if (entity === ExecutionEventEntity) return eventRepo;
        if (entity === ExecutionArtifactEntity) return artifactRepo;
        if (entity === WorkerEntity) return workerRepo;
        throw new Error(`Unexpected repository ${entity.name}`);
      }),
      query: jest.fn().mockResolvedValue([]),
      save: jest.fn(async (value) => value),
    };
    service = new ExecutionAttemptService({
      transaction: jest.fn(async (callback) => callback(manager)),
      getRepository: manager.getRepository,
    } as any);
  });

  it('reports cancellation without extending the lease before an effect', async () => {
    const attempt = runningAttempt();
    const originalExpiry = attempt.leaseExpiresAt;
    attemptRepo.findOne.mockResolvedValue(attempt);
    stepRepo.findOne.mockResolvedValue({
      ...readyStep(),
      status: ExecutionStepStatus.RUNNING,
      currentAttemptId: ATTEMPT_ID,
    });
    executionRepo.findOneBy.mockResolvedValue({
      executionId: EXECUTION_ID,
      status: ExecutionStatus.RUNNING,
      cancellationRequestedAt: new Date(),
    });

    const control = await service.renewAttemptLease(
      ATTEMPT_ID,
      WORKER_ID,
      60_000,
    );

    expect(control).toEqual({
      leaseExpiresAt: originalExpiry,
      leaseRemainingMs: expect.any(Number),
      cancelled: true,
    });
    expect(control.leaseRemainingMs).toBeGreaterThan(0);
    expect(attemptRepo.save).not.toHaveBeenCalled();
  });

  it('reports the server-side lease window capped by the step deadline', async () => {
    const attempt = runningAttempt();
    const deadline = new Date(Date.now() + 10_000);
    attemptRepo.findOne.mockResolvedValue(attempt);
    stepRepo.findOne.mockResolvedValue({
      ...readyStep(),
      status: ExecutionStepStatus.RUNNING,
      currentAttemptId: ATTEMPT_ID,
      deadline,
    });
    executionRepo.findOneBy.mockResolvedValue({
      executionId: EXECUTION_ID,
      status: ExecutionStatus.RUNNING,
      cancellationRequestedAt: null,
    });

    const control = await service.renewAttemptLease(
      ATTEMPT_ID,
      WORKER_ID,
      60_000,
    );

    expect(control.cancelled).toBe(false);
    expect(control.leaseExpiresAt).toEqual(deadline);
    expect(control.leaseRemainingMs).toBeGreaterThan(0);
    expect(control.leaseRemainingMs).toBeLessThanOrEqual(10_000);
    expect(attemptRepo.save).toHaveBeenCalledWith(attempt);
  });

  it('exposes cancellation to a federated reader before artifact creation', async () => {
    attemptRepo.findOneBy.mockResolvedValue(runningAttempt());
    stepRepo.findOneBy.mockResolvedValue({
      ...readyStep(),
      status: ExecutionStepStatus.RUNNING,
      currentAttemptId: ATTEMPT_ID,
    });
    executionRepo.findOneBy.mockResolvedValue({
      executionId: EXECUTION_ID,
      status: ExecutionStatus.RUNNING,
      cancellationRequestedAt: new Date(),
    });

    const control = await service.readAttemptControl(ATTEMPT_ID, WORKER_ID);

    expect(control.cancelled).toBe(true);
    expect(control.leaseExpiresAt).toEqual(expect.any(Date));
  });

  it('revokes input artifact access after cancellation was requested', async () => {
    attemptRepo.findOneBy.mockResolvedValue(runningAttempt());
    stepRepo.findOneBy.mockResolvedValue({
      ...readyStep(),
      status: ExecutionStepStatus.RUNNING,
      currentAttemptId: ATTEMPT_ID,
      inputArtifactRefs: [{ role: 'source', artifactId: ARTIFACT_ID }],
    });
    executionRepo.findOneBy.mockResolvedValue({
      executionId: EXECUTION_ID,
      status: ExecutionStatus.RUNNING,
      cancellationRequestedAt: new Date(),
    });

    await expect(
      service.getInputArtifact(ATTEMPT_ID, WORKER_ID, ARTIFACT_ID),
    ).rejects.toThrow('artifact_not_authorized');
  });

  it('stores an output artifact under the active fenced attempt', async () => {
    const body = Buffer.from('{"points":[]}');
    attemptRepo.findOne.mockResolvedValue(runningAttempt());
    stepRepo.findOneBy.mockResolvedValue({
      ...readyStep(),
      currentAttemptId: ATTEMPT_ID,
    });
    executionRepo.findOneBy.mockResolvedValue({
      executionId: EXECUTION_ID,
      rootExecutionId: EXECUTION_ID,
    });

    const ack = await service.uploadOutputArtifact(ATTEMPT_ID, WORKER_ID, {
      artifactId: ARTIFACT_ID,
      kind: 'vector_points',
      contentHash: `sha256:${createHash('sha256').update(body).digest('hex')}`,
      size: body.length,
      mediaType: 'application/json',
      bodyBase64: body.toString('base64'),
      dataClassification: 'workspace',
    });

    expect(ack.code).toBe('received');
    expect(artifactRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactId: ARTIFACT_ID,
        producedByAttemptId: ATTEMPT_ID,
        body,
      }),
    );
  });

  it('fences an output artifact after the attempt is superseded', async () => {
    const body = Buffer.from('{"points":[]}');
    attemptRepo.findOne.mockResolvedValue(runningAttempt());
    stepRepo.findOneBy.mockResolvedValue({
      ...readyStep(),
      currentAttemptId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca799',
    });

    const ack = await service.uploadOutputArtifact(ATTEMPT_ID, WORKER_ID, {
      artifactId: ARTIFACT_ID,
      kind: 'vector_points',
      contentHash: `sha256:${createHash('sha256').update(body).digest('hex')}`,
      size: body.length,
      mediaType: 'application/json',
      bodyBase64: body.toString('base64'),
      dataClassification: 'workspace',
    });

    expect(ack.code).toBe('stale_attempt');
    expect(artifactRepo.save).not.toHaveBeenCalled();
  });

  it('rejects a new output artifact after cancellation was requested', async () => {
    const body = Buffer.from('{"points":[]}');
    attemptRepo.findOne.mockResolvedValue(runningAttempt());
    stepRepo.findOneBy.mockResolvedValue({
      ...readyStep(),
      status: ExecutionStepStatus.RUNNING,
      currentAttemptId: ATTEMPT_ID,
    });
    executionRepo.findOneBy.mockResolvedValue({
      executionId: EXECUTION_ID,
      rootExecutionId: EXECUTION_ID,
      status: ExecutionStatus.RUNNING,
      cancellationRequestedAt: new Date(),
    });

    const ack = await service.uploadOutputArtifact(ATTEMPT_ID, WORKER_ID, {
      artifactId: ARTIFACT_ID,
      kind: 'vector_points',
      contentHash: `sha256:${createHash('sha256').update(body).digest('hex')}`,
      size: body.length,
      mediaType: 'application/json',
      bodyBase64: body.toString('base64'),
      dataClassification: 'workspace',
    });

    expect(ack.code).toBe('stale_attempt');
    expect(artifactRepo.save).not.toHaveBeenCalled();
  });

  it('keeps the duplicate artifact acknowledgement after cancellation', async () => {
    const body = Buffer.from('{"points":[]}');
    const contentHash = `sha256:${createHash('sha256').update(body).digest('hex')}`;
    attemptRepo.findOne.mockResolvedValue(runningAttempt());
    stepRepo.findOneBy.mockResolvedValue({
      ...readyStep(),
      status: ExecutionStepStatus.RUNNING,
      currentAttemptId: ATTEMPT_ID,
    });
    executionRepo.findOneBy.mockResolvedValue({
      executionId: EXECUTION_ID,
      rootExecutionId: EXECUTION_ID,
      status: ExecutionStatus.RUNNING,
      cancellationRequestedAt: new Date(),
    });
    artifactRepo.findOneBy.mockResolvedValue({
      artifactId: ARTIFACT_ID,
      rootExecutionId: EXECUTION_ID,
      producedByAttemptId: ATTEMPT_ID,
      kind: 'vector_points',
      mediaType: 'application/json',
      contentHash,
      size: String(body.length),
    });

    const ack = await service.uploadOutputArtifact(ATTEMPT_ID, WORKER_ID, {
      artifactId: ARTIFACT_ID,
      kind: 'vector_points',
      contentHash,
      size: body.length,
      mediaType: 'application/json',
      bodyBase64: body.toString('base64'),
      dataClassification: 'workspace',
    });

    expect(ack.code).toBe('duplicate');
    expect(artifactRepo.save).not.toHaveBeenCalled();
  });

  it('accepts only result artifacts produced by the same attempt', async () => {
    const attempt = runningAttempt();
    const step = {
      ...readyStep(),
      status: ExecutionStepStatus.RUNNING,
      currentAttemptId: ATTEMPT_ID,
    };
    attemptRepo.findOne.mockResolvedValue(attempt);
    stepRepo.findOne.mockResolvedValue(step);
    operationRepo.findOne.mockResolvedValue(dispatchedOperation());
    artifactRepo.findBy.mockResolvedValue([
      { artifactId: ARTIFACT_ID, producedByAttemptId: ATTEMPT_ID },
    ]);

    const ack = await service.receiveResult({
      executionId: EXECUTION_ID,
      stepId: STEP_ID,
      operationId: OPERATION_ID,
      attemptId: ATTEMPT_ID,
      workerId: WORKER_ID,
      result: {
        status: 'succeeded',
        stepKind: ExecutionStepKind.SERVICE,
        output: { value: { score: 0.5 } },
        artifactRefs: [
          { role: 'vector_points', artifactId: ARTIFACT_ID, revision: 1 },
        ],
      },
    });

    expect(ack.code).toBe('received');
    expect(step.outputArtifactRefs).toEqual([
      { role: 'vector_points', artifactId: ARTIFACT_ID, revision: 1 },
    ]);
  });

  it('rejects a result artifact produced by another attempt', async () => {
    const attempt = runningAttempt();
    const step = {
      ...readyStep(),
      status: ExecutionStepStatus.RUNNING,
      currentAttemptId: ATTEMPT_ID,
    };
    attemptRepo.findOne.mockResolvedValue(attempt);
    stepRepo.findOne.mockResolvedValue(step);
    operationRepo.findOne.mockResolvedValue(dispatchedOperation());
    artifactRepo.findBy.mockResolvedValue([
      {
        artifactId: ARTIFACT_ID,
        producedByAttemptId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca799',
      },
    ]);

    await expect(
      service.receiveResult({
        executionId: EXECUTION_ID,
        stepId: STEP_ID,
        operationId: OPERATION_ID,
        attemptId: ATTEMPT_ID,
        workerId: WORKER_ID,
        result: {
          status: 'succeeded',
          stepKind: ExecutionStepKind.SERVICE,
          artifactRefs: [
            { role: 'vector_points', artifactId: ARTIFACT_ID, revision: 1 },
          ],
        },
      }),
    ).rejects.toThrow(BadRequestException);
    expect(stepRepo.save).not.toHaveBeenCalled();
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
    expect(operationRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: ExecutionOperationStatus.DISPATCHED,
        currentAttemptId: attempt.attemptId,
      }),
    );
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'operation.started',
        operationId: OPERATION_ID,
        attemptId: attempt.attemptId,
        envelope: expect.objectContaining({
          stepId: STEP_ID,
          operationId: OPERATION_ID,
          attemptId: attempt.attemptId,
          payload: expect.objectContaining({
            operationKind: 'artifact_processing',
            status: 'dispatched',
            name: 'detect-language',
          }),
        }),
      }),
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
      [[ExecutionStepKind.SERVICE], ['detect-language'], null],
    );
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining(`"executions"."status" IN ('queued', 'running')`),
      [[ExecutionStepKind.SERVICE], ['detect-language'], null],
    );
  });

  it('retries an empty claim until work becomes available', async () => {
    jest.useFakeTimers();
    const assignment = {
      schemaVersion: 'step-assignment/1' as const,
      executionId: EXECUTION_ID,
      stepId: STEP_ID,
      operationId: OPERATION_ID,
      attemptId: ATTEMPT_ID,
      stepKind: ExecutionStepKind.SERVICE,
      dependsOnStepIds: [],
      inputArtifactRefs: [],
      work: { taskType: 'detect-language' },
      limits: { maxDurationMs: 30_000 },
      deadline: new Date(Date.now() + 30_000).toISOString(),
    };
    const claim = jest
      .spyOn(service, 'claimReadyStep')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(assignment);

    try {
      const pending = service.claimReadyStepWithWait(
        {
          workerId: WORKER_ID,
          stepKinds: [ExecutionStepKind.SERVICE],
          capabilities: ['detect-language'],
          leaseDurationMs: 30_000,
        },
        1_000,
      );
      await jest.advanceTimersByTimeAsync(1_000);

      await expect(pending).resolves.toEqual(assignment);
      expect(claim).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('performs one immediate claim when waiting is disabled', async () => {
    const claim = jest.spyOn(service, 'claimReadyStep').mockResolvedValue(null);

    await expect(
      service.claimReadyStepWithWait(
        {
          workerId: WORKER_ID,
          stepKinds: [ExecutionStepKind.SERVICE],
          capabilities: ['detect-language'],
          leaseDurationMs: 30_000,
        },
        0,
      ),
    ).resolves.toBeNull();
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it('rejects an excessive claim wait before querying for work', async () => {
    const claim = jest.spyOn(service, 'claimReadyStep');

    await expect(
      service.claimReadyStepWithWait(
        {
          workerId: WORKER_ID,
          stepKinds: [ExecutionStepKind.SERVICE],
          capabilities: ['detect-language'],
          leaseDurationMs: 30_000,
        },
        30_001,
      ),
    ).rejects.toThrow('invalid_claim_wait');
    expect(claim).not.toHaveBeenCalled();
  });

  it('does not claim beyond the registered worker concurrency', async () => {
    workerRepo.findOne.mockResolvedValue({
      id: WORKER_ID,
      status: 'online',
      stepKinds: [ExecutionStepKind.SERVICE],
      capabilities: ['detect-language'],
      maximumConcurrency: 1,
    });
    attemptRepo.count.mockResolvedValue(1);

    await expect(
      service.claimReadyStep({
        workerId: WORKER_ID,
        stepKinds: [ExecutionStepKind.SERVICE],
        capabilities: ['detect-language'],
        leaseDurationMs: 30_000,
        enforceRegisteredWorkerCapacity: true,
      }),
    ).resolves.toBeNull();
    expect(manager.query).not.toHaveBeenCalled();
  });

  it('rejects claim capabilities absent from worker registration', async () => {
    workerRepo.findOne.mockResolvedValue({
      id: WORKER_ID,
      status: 'online',
      stepKinds: [ExecutionStepKind.SERVICE],
      capabilities: ['detect-language'],
      maximumConcurrency: 1,
    });

    await expect(
      service.claimReadyStep({
        workerId: WORKER_ID,
        stepKinds: [ExecutionStepKind.SERVICE],
        capabilities: ['detect-language', 'embedding'],
        leaseDurationMs: 30_000,
        enforceRegisteredWorkerCapacity: true,
      }),
    ).rejects.toThrow('claim_capabilities_not_registered');
    expect(attemptRepo.count).not.toHaveBeenCalled();
  });

  it('does not let a registered Models worker claim tool work', async () => {
    workerRepo.findOne.mockResolvedValue({
      id: WORKER_ID,
      workerKind: WorkerKind.MODELS,
      status: 'online',
      stepKinds: [ExecutionStepKind.TOOL],
      capabilities: ['tool.browser.read_current_page/1'],
      maximumConcurrency: 1,
    });

    await expect(
      service.claimReadyStep({
        workerId: WORKER_ID,
        stepKinds: [ExecutionStepKind.TOOL],
        capabilities: ['tool.browser.read_current_page/1'],
        leaseDurationMs: 30_000,
        enforceRegisteredWorkerCapacity: true,
      }),
    ).rejects.toThrow('models_tool_steps_not_allowed');
    expect(attemptRepo.count).not.toHaveBeenCalled();
    expect(manager.query).not.toHaveBeenCalled();
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
    operationRepo.findOne.mockResolvedValue(dispatchedOperation());

    await expect(service.expireAttempt(ATTEMPT_ID)).resolves.toBe(true);
    expect(attempt.status).toBe(ExecutionStepAttemptStatus.EXPIRED);
    expect(step.status).toBe(ExecutionStepStatus.READY);
    expect(step.currentAttemptId).toBeNull();
  });

  it('does not replay an ambiguous operation after its lease expires', async () => {
    const attempt = {
      ...runningAttempt(),
      leaseExpiresAt: new Date(Date.now() - 1_000),
    };
    const step = {
      ...readyStep(),
      status: ExecutionStepStatus.RUNNING,
      currentAttemptId: ATTEMPT_ID,
    };
    const operation = {
      ...dispatchedOperation(),
      recoveryClass: ExecutionOperationRecoveryClass.NON_RESUMABLE,
    };
    const execution = {
      executionId: EXECUTION_ID,
      status: ExecutionStatus.RUNNING,
      phase: null,
      error: null,
    };
    attemptRepo.findOne.mockResolvedValue(attempt);
    stepRepo.findOne.mockResolvedValue(step);
    operationRepo.findOne.mockResolvedValue(operation);
    executionRepo.findOne.mockResolvedValue(execution);

    await expect(service.expireAttempt(ATTEMPT_ID)).resolves.toBe(true);
    expect(step.status).toBe(ExecutionStepStatus.FAILED);
    expect(operation).toEqual(
      expect.objectContaining({
        status: ExecutionOperationStatus.UNKNOWN,
        currentAttemptId: null,
        error: expect.objectContaining({ code: 'effect_unknown' }),
      }),
    );
    expect(execution).toEqual(
      expect.objectContaining({
        status: ExecutionStatus.RUNNING,
        phase: 'terminal_pending_failed',
      }),
    );
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
    operationRepo.findOne.mockResolvedValue(dispatchedOperation());

    const ack = await service.receiveResult({
      executionId: EXECUTION_ID,
      stepId: STEP_ID,
      operationId: OPERATION_ID,
      attemptId: ATTEMPT_ID,
      workerId: WORKER_ID,
      result: {
        status: 'succeeded',
        stepKind: ExecutionStepKind.SERVICE,
      },
    });

    expect(ack.code).toBe('received');
    expect(ack.receiptId).toEqual(expect.any(String));
    expect(attempt.status).toBe(ExecutionStepAttemptStatus.RESULT_RECEIVED);
    expect(step.status).toBe(ExecutionStepStatus.RESULT_RECEIVED);
    expect(receiptRepo.save).toHaveBeenCalledTimes(1);
  });

  it('accepts a canonical tool result only for its materialized plan', async () => {
    const attempt = runningAttempt();
    const step = {
      ...readyStep(),
      stepKind: ExecutionStepKind.TOOL,
      status: ExecutionStepStatus.RUNNING,
      currentAttemptId: ATTEMPT_ID,
    };
    attemptRepo.findOne.mockResolvedValue(attempt);
    stepRepo.findOne.mockResolvedValue(step);
    operationRepo.findOne.mockResolvedValue(dispatchedOperation());

    const ack = await service.receiveResult({
      executionId: EXECUTION_ID,
      stepId: STEP_ID,
      operationId: OPERATION_ID,
      attemptId: ATTEMPT_ID,
      workerId: WORKER_ID,
      result: {
        stepKind: ExecutionStepKind.TOOL,
        status: 'succeeded',
        output: {
          kind: ExecutionStepKind.TOOL,
          toolResult: {
            schemaVersion: 'tool-result/1',
            operationId: OPERATION_ID,
            toolCallId: TOOL_CALL_ID,
            status: 'succeeded',
            content: 'One match',
            structuredContent: { count: 1 },
            artifactRefs: [],
            sourceRefs: [],
            effects: [],
            error: null,
          },
        },
      },
    });

    expect(ack.code).toBe('received');
    expect(toolPlanRepo.findOneBy).toHaveBeenCalledWith({
      operationId: OPERATION_ID,
    });
  });

  it('rejects disagreement between StepResult and ToolResult status', async () => {
    await expect(
      service.receiveResult({
        executionId: EXECUTION_ID,
        stepId: STEP_ID,
        operationId: OPERATION_ID,
        attemptId: ATTEMPT_ID,
        workerId: WORKER_ID,
        result: {
          stepKind: ExecutionStepKind.TOOL,
          status: 'failed',
          output: {
            kind: ExecutionStepKind.TOOL,
            toolResult: {
              schemaVersion: 'tool-result/1',
              operationId: OPERATION_ID,
              toolCallId: TOOL_CALL_ID,
              status: 'succeeded',
              content: 'One match',
              structuredContent: { count: 1 },
              artifactRefs: [],
              sourceRefs: [],
              effects: [],
              error: null,
            },
          },
        },
      }),
    ).rejects.toThrow('tool_result_status_mismatch');
    expect(receiptRepo.save).not.toHaveBeenCalled();
  });

  it('persists ToolResult as the canonical operation result', async () => {
    const step = {
      ...readyStep(),
      stepKind: ExecutionStepKind.TOOL,
      status: ExecutionStepStatus.RESULT_RECEIVED,
      currentAttemptId: ATTEMPT_ID,
    };
    const attempt = {
      ...runningAttempt(),
      status: ExecutionStepAttemptStatus.RESULT_RECEIVED,
    };
    const operation = {
      ...dispatchedOperation(),
      operationKind: ExecutionOperationKind.TOOL_CALL,
    };
    const execution = {
      executionId: EXECUTION_ID,
      status: ExecutionStatus.RUNNING,
      phase: null,
      result: null,
      error: null,
    };
    const toolResult = {
      schemaVersion: 'tool-result/1',
      operationId: OPERATION_ID,
      toolCallId: TOOL_CALL_ID,
      status: 'succeeded',
      content: 'One match',
      structuredContent: { count: 1 },
      artifactRefs: [],
      sourceRefs: [],
      effects: [],
      error: null,
    };
    manager.query
      .mockResolvedValueOnce([{ step_id: STEP_ID }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    stepRepo.findOneBy.mockResolvedValue(step);
    attemptRepo.findOneBy.mockResolvedValue(attempt);
    receiptRepo.findOne.mockResolvedValue({
      result: {
        stepKind: ExecutionStepKind.TOOL,
        status: 'succeeded',
        output: { kind: ExecutionStepKind.TOOL, toolResult },
      },
    });
    executionRepo.findOne.mockResolvedValue(execution);
    operationRepo.findOne.mockResolvedValue(operation);

    await expect(service.processReceivedResults()).resolves.toBe(1);
    expect(operation).toEqual(
      expect.objectContaining({
        status: ExecutionOperationStatus.SUCCEEDED,
        result: toolResult,
        error: null,
      }),
    );
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'operation.finished',
        operationId: OPERATION_ID,
        attemptId: ATTEMPT_ID,
        envelope: expect.objectContaining({
          stepId: STEP_ID,
          operationId: OPERATION_ID,
          toolCallId: TOOL_CALL_ID,
          attemptId: ATTEMPT_ID,
          payload: expect.objectContaining({
            operationKind: 'tool_call',
            status: 'succeeded',
            result: toolResult,
            error: null,
          }),
        }),
      }),
    );
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
    stepRepo.findOneBy.mockResolvedValueOnce(step).mockResolvedValueOnce({
      stepId: 'dependent-step',
      status: ExecutionStepStatus.BLOCKED,
      version: 1,
      work: { taskType: 'next-step' },
    });
    attemptRepo.findOneBy.mockResolvedValue(attempt);
    receiptRepo.findOne.mockResolvedValue({
      result: { status: 'succeeded', output: { value: 42 } },
    });
    executionRepo.findOne.mockResolvedValue(execution);
    operationRepo.findOne.mockResolvedValue(dispatchedOperation());

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
    operationRepo.findOne.mockResolvedValue(dispatchedOperation());

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

  it('persists a failed result as a terminal intent without bypassing the outbox', async () => {
    const step = {
      ...readyStep(),
      status: ExecutionStepStatus.RESULT_RECEIVED,
      currentAttemptId: ATTEMPT_ID,
    };
    const attempt = {
      ...runningAttempt(),
      status: ExecutionStepAttemptStatus.RESULT_RECEIVED,
    };
    const operation = dispatchedOperation();
    const execution = {
      executionId: EXECUTION_ID,
      status: ExecutionStatus.RUNNING,
      phase: null,
      error: null,
    };
    manager.query
      .mockResolvedValueOnce([{ step_id: STEP_ID }])
      .mockResolvedValueOnce([]);
    stepRepo.findOneBy.mockResolvedValue(step);
    attemptRepo.findOneBy.mockResolvedValue(attempt);
    receiptRepo.findOne.mockResolvedValue({
      result: {
        status: 'failed',
        error: { code: 'MODEL_FAILED', message: 'Model failed' },
      },
    });
    executionRepo.findOne.mockResolvedValue(execution);
    operationRepo.findOne.mockResolvedValue(operation);

    await expect(service.processReceivedResults()).resolves.toBe(1);
    expect(step.status).toBe(ExecutionStepStatus.FAILED);
    expect(operation.status).toBe(ExecutionOperationStatus.FAILED);
    expect(execution).toEqual(
      expect.objectContaining({
        status: ExecutionStatus.RUNNING,
        phase: 'terminal_pending_failed',
      }),
    );
  });

  it('routes a failed result through required domain reconciliation', async () => {
    const step = {
      ...readyStep(),
      status: ExecutionStepStatus.RESULT_RECEIVED,
      currentAttemptId: ATTEMPT_ID,
      finalizeOnFailure: true,
    };
    const attempt = {
      ...runningAttempt(),
      status: ExecutionStepAttemptStatus.RESULT_RECEIVED,
    };
    const operation = dispatchedOperation();
    const execution = {
      executionId: EXECUTION_ID,
      status: ExecutionStatus.RUNNING,
      phase: null,
      error: null,
    };
    manager.query
      .mockResolvedValueOnce([{ step_id: STEP_ID }])
      .mockResolvedValueOnce([]);
    stepRepo.findOneBy.mockResolvedValue(step);
    attemptRepo.findOneBy.mockResolvedValue(attempt);
    receiptRepo.findOne.mockResolvedValue({
      result: {
        status: 'failed',
        error: { code: 'MODEL_FAILED', message: 'Model failed' },
      },
    });
    executionRepo.findOne.mockResolvedValue(execution);
    operationRepo.findOne.mockResolvedValue(operation);

    await expect(service.processReceivedResults()).resolves.toBe(1);
    expect(execution).toEqual(
      expect.objectContaining({
        status: ExecutionStatus.RUNNING,
        phase: 'backend_failure_finalization',
        error: { code: 'MODEL_FAILED', message: 'Model failed' },
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
    operationRepo.findOne.mockResolvedValue(dispatchedOperation());

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

  it('does not overwrite a durable terminal intent with a parallel success', async () => {
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
      phase: 'terminal_pending_failed',
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
    operationRepo.findOne.mockResolvedValue(dispatchedOperation());

    await expect(service.processReceivedResults()).resolves.toBe(1);
    expect(execution).toEqual(
      expect.objectContaining({
        status: ExecutionStatus.RUNNING,
        phase: 'terminal_pending_failed',
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
    operationRepo.findOne.mockResolvedValue(dispatchedOperation());

    const ack = await service.receiveResult({
      executionId: EXECUTION_ID,
      stepId: STEP_ID,
      operationId: OPERATION_ID,
      attemptId: ATTEMPT_ID,
      workerId: WORKER_ID,
      result: {
        status: 'succeeded',
        stepKind: ExecutionStepKind.SERVICE,
      },
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

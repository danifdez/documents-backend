import { randomUUID } from 'crypto';
import { config as loadEnv } from 'dotenv';
import { DataSource, In } from 'typeorm';
import { CreateExecutions1757668140001 } from '../migrations/1757668140001-CreateExecutions';
import { AddExecutionProgress1757668140350 } from '../migrations/1757668140350-AddExecutionProgress';
import { CreateExecutionControlPlane1757668140370 } from '../migrations/1757668140370-CreateExecutionControlPlane';
import { AddWorkerCredentials1757668140380 } from '../migrations/1757668140380-AddWorkerCredentials';
import { ExecutionArtifactEntity } from '../src/execution/execution-artifact.entity';
import { ExecutionContractValidator } from '../src/execution/execution-contract-validator';
import { ExecutionEventEntity } from '../src/execution/execution-event.entity';
import { ExecutionEntity } from '../src/execution/execution.entity';
import { ExecutionResultReceiptEntity } from '../src/execution/execution-result-receipt.entity';
import { ExecutionAttemptService } from '../src/execution/execution-attempt.service';
import { ExecutionStepAttemptEntity } from '../src/execution/execution-step-attempt.entity';
import { ExecutionStepAttemptStatus } from '../src/execution/execution-step-attempt-status.enum';
import { ExecutionStepDependencyEntity } from '../src/execution/execution-step-dependency.entity';
import { ExecutionStepEntity } from '../src/execution/execution-step.entity';
import { ExecutionStepStatus } from '../src/execution/execution-step-status.enum';
import { ExecutionStepKind } from '../src/execution/execution-step-kind.enum';
import { ExecutionPriority } from '../src/execution/execution-priority.enum';
import { ExecutionStatus } from '../src/execution/execution-status.enum';
import {
  contentHash,
  ExecutionService,
} from '../src/execution/execution.service';
import { WorkerEntity } from '../src/worker/worker.entity';
import { WorkerService } from '../src/worker/worker.service';

loadEnv({ path: '.env' });

describe('execution PostgreSQL integration', () => {
  const schema = `execution_test_${randomUUID().replaceAll('-', '_')}`;
  let dataSource: DataSource;
  let service: ExecutionService;
  let attemptService: ExecutionAttemptService;
  let workerService: WorkerService;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.POSTGRES_HOST,
      port: Number(process.env.POSTGRES_PORT),
      username: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DB,
      schema,
      synchronize: false,
      entities: [
        ExecutionEntity,
        ExecutionEventEntity,
        ExecutionArtifactEntity,
        ExecutionStepEntity,
        ExecutionStepDependencyEntity,
        ExecutionStepAttemptEntity,
        ExecutionResultReceiptEntity,
        WorkerEntity,
      ],
    });
    await dataSource.initialize();
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.query(`CREATE SCHEMA "${schema}"`);
    await runner.query(`SET search_path TO "${schema}"`);
    await new CreateExecutions1757668140001().up(runner);
    await new AddExecutionProgress1757668140350().up(runner);
    await new CreateExecutionControlPlane1757668140370().up(runner);
    await runner.query(`
      CREATE TABLE "workers" (
        "id" uuid PRIMARY KEY,
        "name" varchar NOT NULL,
        "capabilities" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "status" varchar NOT NULL DEFAULT 'online',
        "last_heartbeat" timestamp NOT NULL DEFAULT now(),
        "started_at" timestamp NOT NULL DEFAULT now(),
        "metadata" jsonb
      )
    `);
    await new AddWorkerCredentials1757668140380().up(runner);
    await runner.release();

    service = new ExecutionService(
      dataSource,
      dataSource.getRepository(ExecutionEntity),
      dataSource.getRepository(ExecutionEventEntity),
      dataSource.getRepository(ExecutionArtifactEntity),
      { get: (_key: string, fallback?: unknown) => fallback } as any,
      new ExecutionContractValidator(),
    );
    attemptService = new ExecutionAttemptService(
      dataSource,
      new ExecutionContractValidator(),
    );
    workerService = new WorkerService(dataSource.getRepository(WorkerEntity));
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await dataSource.destroy();
  });

  const progress = (context: any, instanceId: string) => ({
    eventId: randomUUID(),
    rootExecutionId: context.rootExecutionId,
    executionId: context.executionId,
    turnId: context.turnId,
    producerSequence: 1,
    eventType: 'progress.reported',
    producer: { component: 'documents-models', instanceId, version: 'test' },
    actor: { type: 'worker' },
    causedByEventId: context.lastEventId,
    occurredAt: '2026-08-19T10:00:01Z',
    payloadSchema: 'progress.reported/1',
    payload: { message: `progress from ${instanceId}` },
    artifactRefs: [],
    security: {
      dataClassification: 'workspace',
      purpose: 'evaluation',
      allowedDestinations: ['documents', 'ai-train'],
      redactionApplied: false,
    },
  });

  const activateStepAttempt = async (
    executionId: string,
    attemptId: string,
  ): Promise<void> => {
    await dataSource.transaction(async (manager) => {
      const executionRepo = manager.getRepository(ExecutionEntity);
      const execution = await executionRepo.findOneByOrFail({ executionId });
      const stepRepo = manager.getRepository(ExecutionStepEntity);
      const step = await stepRepo.findOneByOrFail({ executionId });
      if (step.currentAttemptId) {
        const previous = await manager
          .getRepository(ExecutionStepAttemptEntity)
          .findOneByOrFail({ attemptId: step.currentAttemptId });
        step.currentAttemptId = null;
        step.status = ExecutionStepStatus.READY;
        await stepRepo.save(step);
        previous.status = ExecutionStepAttemptStatus.EXPIRED;
        previous.finishedAt = new Date();
        previous.finishReason = 'superseded_by_test_attempt';
        await manager.save(previous);
      }
      const now = new Date();
      await manager.save(
        manager.getRepository(ExecutionStepAttemptEntity).create({
          attemptId,
          executionId,
          stepId: step.stepId,
          operationId: step.operationId,
          schemaVersion: 'step-attempt/1',
          claimedBy: randomUUID(),
          status: ExecutionStepAttemptStatus.RUNNING,
          leaseGrantedAt: now,
          leaseExpiresAt: new Date(now.getTime() + 60 * 60 * 1_000),
          heartbeatAt: now,
          startedAt: now,
          finishedAt: null,
          finishReason: null,
          resultReceiptId: null,
        }),
      );
      step.currentAttemptId = attemptId;
      step.status = ExecutionStepStatus.RUNNING;
      await stepRepo.save(step);
      execution.status = ExecutionStatus.RUNNING;
      execution.phase = 'worker_execution';
      await executionRepo.save(execution);
    });
  };

  it('commits an execution and its initial step atomically', async () => {
    const inputBody = Buffer.from('Hello artifact', 'utf8');
    const created = await service.create(
      'detect-language',
      ExecutionPriority.NORMAL,
      { content: 'Hello' },
      {
        inputArtifacts: [
          {
            role: 'source',
            kind: 'language_sample',
            mediaType: 'text/plain',
            body: inputBody,
          },
        ],
        initialStep: {
          stepKind: ExecutionStepKind.CODE,
          work: { taskType: 'detect-language', content: 'Hello' },
          requiredCapabilities: ['detect-language'],
          resourceKeys: ['resource:language-detection'],
        },
      },
    );

    expect(created.schemaVersion).toBe('execution/1');
    await expect(
      dataSource.getRepository(ExecutionStepEntity).findOneByOrFail({
        executionId: created.executionId,
      }),
    ).resolves.toMatchObject({
      executionId: created.executionId,
      schemaVersion: 'step/1',
      stepKind: ExecutionStepKind.CODE,
      status: 'ready',
      work: { taskType: 'detect-language', content: 'Hello' },
    });

    const countBeforeRollback = await dataSource
      .getRepository(ExecutionEntity)
      .count();
    await expect(
      service.create(
        'invalid-step',
        ExecutionPriority.NORMAL,
        {},
        {
          initialStep: {
            stepKind: ExecutionStepKind.CODE,
            work: {},
            availableAt: new Date('2026-08-19T10:00:00Z'),
            deadline: new Date('2026-08-19T09:00:00Z'),
          },
        },
      ),
    ).rejects.toThrow('invalid_step_deadline');
    await expect(
      dataSource.getRepository(ExecutionEntity).count(),
    ).resolves.toBe(countBeforeRollback);

    const workerId = randomUUID();
    const assignment = await attemptService.claimReadyStep({
      workerId,
      stepKinds: [ExecutionStepKind.CODE],
      capabilities: ['detect-language'],
      leaseDurationMs: 30_000,
    });
    expect(assignment).toMatchObject({
      schemaVersion: 'step-assignment/1',
      executionId: created.executionId,
      stepKind: ExecutionStepKind.CODE,
      work: { taskType: 'detect-language', content: 'Hello' },
    });
    expect(assignment!.inputArtifactRefs).toHaveLength(1);
    await expect(
      attemptService.getInputArtifact(
        assignment!.attemptId,
        workerId,
        assignment!.inputArtifactRefs[0].artifactId,
      ),
    ).resolves.toMatchObject({ body: inputBody, mediaType: 'text/plain' });
    await expect(
      attemptService.renewAttemptLease(assignment!.attemptId, workerId, 60_000),
    ).resolves.toMatchObject({ cancelled: false });
    await expect(
      attemptService.readAttemptControl(assignment!.attemptId, workerId),
    ).resolves.toMatchObject({ cancelled: false });
  });

  it('registers and authenticates an isolated Models identity', async () => {
    const workerId = randomUUID();
    const registration = await workerService.register(
      workerId,
      'models-e2e',
      ['detect-language'],
      { runtime: 'test' },
    );

    expect(registration.worker.id).toBe(workerId);
    expect(registration.credential).not.toContain(workerId);
    await expect(
      workerService.authenticate(workerId, registration.credential),
    ).resolves.toBeUndefined();
    await expect(
      workerService.authenticate(workerId, 'wrong-credential'),
    ).rejects.toThrow('invalid_worker_credential');
    const rotation = await workerService.register(
      workerId,
      'models-e2e',
      [],
      {},
    );
    expect(rotation.credential).not.toBe(registration.credential);
    await expect(
      workerService.authenticate(workerId, registration.credential),
    ).rejects.toThrow('invalid_worker_credential');
    await expect(
      workerService.authenticate(workerId, rotation.credential),
    ).resolves.toBeUndefined();
  });

  it('serializes resource claims and acknowledges result retries', async () => {
    const resourceKey = `resource:${randomUUID()}`;
    const executions = await Promise.all(
      ['first', 'second'].map((name) =>
        service.create(
          name,
          ExecutionPriority.NORMAL,
          {},
          {
            initialStep: {
              stepKind: ExecutionStepKind.SERVICE,
              work: { taskType: name },
              resourceKeys: [resourceKey],
            },
          },
        ),
      ),
    );
    const steps = await dataSource.getRepository(ExecutionStepEntity).findBy({
      executionId: In(executions.map((execution) => execution.executionId)),
    });
    expect(steps).toHaveLength(2);

    const claims = await Promise.allSettled(
      steps.map((step) =>
        attemptService.grantAttempt({
          stepId: step.stepId,
          workerId: randomUUID(),
          leaseDurationMs: 30_000,
        }),
      ),
    );
    const granted = claims.filter(
      (claim): claim is PromiseFulfilledResult<ExecutionStepAttemptEntity> =>
        claim.status === 'fulfilled',
    );
    const rejected = claims.filter(
      (claim): claim is PromiseRejectedResult => claim.status === 'rejected',
    );
    expect(granted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0].reason)).toContain('resource_conflict');

    const attempt = granted[0].value;
    await attemptService.startAttempt(attempt.attemptId, attempt.claimedBy);
    const resultEnvelope = {
      schemaVersion: 'step-result/1',
      executionId: attempt.executionId,
      stepId: attempt.stepId,
      operationId: attempt.operationId,
      attemptId: attempt.attemptId,
      stepKind: ExecutionStepKind.SERVICE,
      status: 'succeeded',
      output: { kind: 'service', value: { language: 'en' } },
      artifactRefs: [],
      error: null,
    } as const;
    const result = {
      executionId: resultEnvelope.executionId,
      stepId: resultEnvelope.stepId,
      operationId: resultEnvelope.operationId,
      attemptId: resultEnvelope.attemptId,
      workerId: attempt.claimedBy,
      result: resultEnvelope,
    };
    await expect(attemptService.receiveResult(result)).resolves.toMatchObject({
      code: 'received',
      receiptId: expect.any(String),
    });
    await expect(attemptService.receiveResult(result)).resolves.toMatchObject({
      code: 'duplicate',
      receiptId: expect.any(String),
    });
    await expect(attemptService.processReceivedResults()).resolves.toBe(1);
    await expect(
      dataSource.getRepository(ExecutionEntity).findOneByOrFail({
        executionId: attempt.executionId,
      }),
    ).resolves.toMatchObject({
      status: ExecutionStatus.RUNNING,
      phase: 'backend_finalization',
      result: { language: 'en' },
    });
  });

  it('keeps assistant and agent chat as distinct execution types', async () => {
    const scope = { ownerPrincipal: 'e2e-user', workspaceId: 'e2e-workspace' };
    const assistant = await service.createForChat(
      'assistant_chat',
      'assistant message',
      scope,
      {},
    );
    const agent = await service.createForChat(
      'agent_chat',
      'agent message',
      scope,
      {},
    );

    expect(assistant.taskType).toBe('assistant-chat');
    expect(agent.taskType).toBe('agent-chat');
  });

  it('serializes concurrent producers, paginates, deduplicates, and enforces append-only rows', async () => {
    const scope = { ownerPrincipal: 'e2e-user', workspaceId: 'e2e-workspace' };
    const context = await service.createForChat(
      'assistant_chat',
      'Authorization: Bearer known-secret',
      scope,
      {},
    );
    const first = progress(context, 'worker-a');
    const second = progress(context, 'worker-b');

    await Promise.all([
      service.acceptEvents(context.rootExecutionId, [first]),
      service.acceptEvents(context.rootExecutionId, [second]),
    ]);
    await expect(
      service.acceptEvents(context.rootExecutionId, [first]),
    ).resolves.toMatchObject({
      accepted: 0,
      duplicates: 1,
      lastSequence: 5,
    });

    const page1 = await service.readEvents(
      context.rootExecutionId,
      scope,
      0,
      2,
    );
    const page2 = await service.readEvents(
      context.rootExecutionId,
      scope,
      page1.nextAfterSequence,
      10,
    );
    expect(page1.events.map((event: any) => event.sequence)).toEqual([1, 2]);
    expect(page2.events.map((event: any) => event.sequence)).toEqual([3, 4, 5]);
    await expect(
      service.readEvents(context.rootExecutionId, {
        ownerPrincipal: 'e2e-user',
        workspaceId: 'other',
      }),
    ).rejects.toThrow('Execution not found');

    const bundle = await service.exportBundle(context.rootExecutionId, scope);
    expect(JSON.stringify(bundle)).not.toContain('known-secret');
    expect(bundle.embeddedArtifacts).toBeDefined();
    expect(bundle.bundleCompleteness).toEqual({
      status: 'evaluable_partial',
      reproducible: false,
      missing: ['environment.documentsRevision'],
    });

    await expect(
      dataSource.query(
        `UPDATE "${schema}"."execution_events" SET "event_type" = 'changed' WHERE "event_id" = $1`,
        [first.eventId],
      ),
    ).rejects.toThrow('append-only');
    const stored = await dataSource
      .getRepository(ExecutionEventEntity)
      .findOneBy({
        eventId: first.eventId,
      });
    expect(stored.eventType).toBe('progress.reported');
  });

  it('serializes the last operation budget slots and fences stale attempts', async () => {
    const scope = { ownerPrincipal: 'e2e-user', workspaceId: 'e2e-workspace' };
    const context = await service.createForChat(
      'assistant_chat',
      'budget me',
      scope,
      {},
    );
    const attemptId = randomUUID();
    await activateStepAttempt(context.executionId, attemptId);

    const requestedPolicy = {
      normal: 1,
      normalInferenceSoftLimit: 0,
      repair: 0,
      closing: 0,
      maxTokensPerInference: 512,
      toolCalls: 1,
      toolCallSoftLimit: 0,
      exactToolRepeatWarning: true,
    };
    const { grant } = await service.requestProgressGrant(context.executionId, {
      executionId: context.executionId,
      turnId: context.turnId,
      loopId: context.executionId,
      agentName: 'assistant',
      loopKind: 'top_level',
      executionAttemptId: attemptId,
      requestedPolicy,
    });
    const reserve = (operationId: string, executionAttemptId = attemptId) =>
      service.reserveOperationBudget(context.executionId, {
        executionId: context.executionId,
        loopId: context.executionId,
        grantId: grant.grantId,
        operationId,
        operationKind: 'inference',
        bucket: 'normal',
        phase: 'direct_response',
        round: 1,
        name: 'direct_response',
        executionAttemptId,
      });

    const decisions = await Promise.all([
      reserve(randomUUID()),
      reserve(randomUUID()),
    ]);
    expect(decisions.filter((decision) => decision.granted)).toHaveLength(1);
    expect(decisions.filter((decision) => !decision.granted)).toHaveLength(1);

    const reserveTool = (
      operationId: string,
      toolCallId: string,
      executionAttemptId = attemptId,
    ) =>
      service.reserveOperationBudget(context.executionId, {
        executionId: context.executionId,
        loopId: context.executionId,
        grantId: grant.grantId,
        operationId,
        operationKind: 'tool_call',
        bucket: 'tool',
        toolCallId,
        phase: 'agent_loop',
        round: 1,
        name: 'folder_read',
        executionAttemptId,
      });
    const toolDecisions = await Promise.all([
      reserveTool(randomUUID(), randomUUID()),
      reserveTool(randomUUID(), randomUUID()),
    ]);
    expect(toolDecisions.filter((decision) => decision.granted)).toHaveLength(
      1,
    );
    expect(toolDecisions.filter((decision) => !decision.granted)).toHaveLength(
      1,
    );

    const nextAttemptId = randomUUID();
    await activateStepAttempt(context.executionId, nextAttemptId);
    await expect(reserve(randomUUID())).rejects.toThrow(
      'Execution attempt is not active',
    );
    const repeated = await service.requestProgressGrant(context.executionId, {
      executionId: context.executionId,
      turnId: context.turnId,
      loopId: context.executionId,
      agentName: 'assistant',
      loopKind: 'top_level',
      executionAttemptId: nextAttemptId,
      requestedPolicy,
    });
    expect(repeated.grant.grantId).toBe(grant.grantId);
    await expect(reserve(randomUUID(), nextAttemptId)).resolves.toMatchObject({
      granted: false,
      reservation: { reason: 'budget_hard_limit_reached' },
    });
    await expect(
      reserveTool(randomUUID(), randomUUID(), nextAttemptId),
    ).resolves.toMatchObject({
      granted: false,
      reservation: { reason: 'tool_budget_hard_limit_reached' },
    });
  });

  it('records one soft-limit signal when concurrent tool reservations cross it', async () => {
    const scope = { ownerPrincipal: 'e2e-user', workspaceId: 'e2e-workspace' };
    const context = await service.createForChat(
      'assistant_chat',
      'cross the tool soft limit',
      scope,
      {},
    );
    const attemptId = randomUUID();
    await activateStepAttempt(context.executionId, attemptId);
    const { grant } = await service.requestProgressGrant(context.executionId, {
      executionId: context.executionId,
      turnId: context.turnId,
      loopId: context.executionId,
      agentName: 'assistant',
      loopKind: 'top_level',
      executionAttemptId: attemptId,
      requestedPolicy: {
        normal: 1,
        normalInferenceSoftLimit: 0,
        repair: 0,
        closing: 1,
        maxTokensPerInference: 512,
        toolCalls: 6,
        toolCallSoftLimit: 4,
        exactToolRepeatWarning: true,
      },
    });
    const reserveTool = (operationId = randomUUID()) =>
      service.reserveOperationBudget(context.executionId, {
        executionId: context.executionId,
        loopId: context.executionId,
        grantId: grant.grantId,
        operationId,
        operationKind: 'tool_call',
        bucket: 'tool',
        toolCallId: randomUUID(),
        phase: 'agent_loop',
        round: 1,
        name: 'folder_read',
        executionAttemptId: attemptId,
      });

    await reserveTool();
    await reserveTool();
    await reserveTool();
    const concurrentOperationIds = [randomUUID(), randomUUID()];
    const decisions = await Promise.all(
      concurrentOperationIds.map((operationId) => reserveTool(operationId)),
    );

    expect(decisions.every((decision) => decision.granted)).toBe(true);
    const signals = decisions
      .map((decision) => decision.softLimitSignal)
      .filter(Boolean);
    expect(signals).toHaveLength(1);
    expect(concurrentOperationIds).toContain(signals[0]?.triggeringOperationId);
    const projected = await service.readProgress(
      context.rootExecutionId,
      scope,
    );
    const usage = Object.values(projected.ledger.operationBudget.grants)[0]
      .usage.tool;
    expect(usage).toMatchObject({
      granted: 6,
      reserved: 5,
      consumed: 0,
      available: 1,
      softLimit: 4,
      softLimitReached: true,
    });
    const storedSignals = (
      await dataSource.getRepository(ExecutionEventEntity).find({
        where: { rootExecutionId: context.rootExecutionId },
      })
    ).filter(
      (event) =>
        (event.envelope.payload as Record<string, unknown>)?.kind ===
        'budget_soft_limit_reached',
    );
    expect(storedSignals).toHaveLength(1);
  });

  it('records one soft-limit signal at the normal inference soft limit', async () => {
    const scope = { ownerPrincipal: 'e2e-user', workspaceId: 'e2e-workspace' };
    const context = await service.createForChat(
      'assistant_chat',
      'cross the normal inference soft limit',
      scope,
      {},
    );
    const attemptId = randomUUID();
    await activateStepAttempt(context.executionId, attemptId);
    const { grant } = await service.requestProgressGrant(context.executionId, {
      executionId: context.executionId,
      turnId: context.turnId,
      loopId: context.executionId,
      agentName: 'assistant',
      loopKind: 'top_level',
      executionAttemptId: attemptId,
      requestedPolicy: {
        normal: 3,
        normalInferenceSoftLimit: 2,
        repair: 0,
        closing: 1,
        maxTokensPerInference: 512,
        toolCalls: 0,
        toolCallSoftLimit: 0,
        exactToolRepeatWarning: true,
      },
    });
    const reserveInference = (operationId = randomUUID()) =>
      service.reserveOperationBudget(context.executionId, {
        executionId: context.executionId,
        loopId: context.executionId,
        grantId: grant.grantId,
        operationId,
        operationKind: 'inference',
        bucket: 'normal',
        phase: 'agent_loop',
        round: 1,
        name: 'chat_with_tools',
        executionAttemptId: attemptId,
      });

    await reserveInference();
    const concurrentOperationIds = [randomUUID(), randomUUID()];
    const decisions = await Promise.all(
      concurrentOperationIds.map((operationId) =>
        reserveInference(operationId),
      ),
    );

    expect(decisions.every((decision) => decision.granted)).toBe(true);
    const signals = decisions
      .map((decision) => decision.softLimitSignal)
      .filter(Boolean);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      operationKind: 'inference',
      bucket: 'normal',
      softLimit: 2,
      hardLimit: 3,
    });
    expect(concurrentOperationIds).toContain(signals[0]?.triggeringOperationId);
    const projected = await service.readProgress(
      context.rootExecutionId,
      scope,
    );
    const usage = Object.values(projected.ledger.operationBudget.grants)[0]
      .usage.normal;
    expect(usage).toMatchObject({
      granted: 3,
      reserved: 3,
      consumed: 0,
      available: 0,
      softLimit: 2,
      softLimitReached: true,
      softLimitWarningPending: true,
    });
  });

  it('persists one exact-repeat signal and consumes its warning transactionally', async () => {
    const scope = { ownerPrincipal: 'e2e-user', workspaceId: 'e2e-workspace' };
    const context = await service.createForChat(
      'assistant_chat',
      'repeat one exact tool call',
      scope,
      {},
    );
    const attemptId = randomUUID();
    await activateStepAttempt(context.executionId, attemptId);
    const { grant } = await service.requestProgressGrant(context.executionId, {
      executionId: context.executionId,
      turnId: context.turnId,
      loopId: context.executionId,
      agentName: 'assistant',
      loopKind: 'top_level',
      executionAttemptId: attemptId,
      requestedPolicy: {
        normal: 2,
        normalInferenceSoftLimit: 0,
        repair: 0,
        closing: 1,
        maxTokensPerInference: 512,
        toolCalls: 3,
        toolCallSoftLimit: 0,
        exactToolRepeatWarning: true,
        exactToolRepeatBlockAfterWarning: true,
      },
    });
    const fingerprint = `sha256:${'a'.repeat(64)}`;
    const resultFingerprint = `sha256:${'b'.repeat(64)}`;
    let producerSequence = 0;
    let causedByEventId = (
      await dataSource.getRepository(ExecutionEntity).findOneByOrFail({
        executionId: context.executionId,
      })
    ).lastEventId;
    const accept = async (
      eventType: string,
      payloadSchema: string,
      payload: Record<string, unknown>,
      identity: Record<string, unknown>,
    ) => {
      const eventId = randomUUID();
      await service.acceptEvents(context.rootExecutionId, [
        {
          eventId,
          rootExecutionId: context.rootExecutionId,
          executionId: context.executionId,
          turnId: context.turnId,
          producerSequence: ++producerSequence,
          eventType,
          producer: {
            component: 'documents-models',
            instanceId: `mvp10-${attemptId}`,
            version: 'test',
          },
          actor: {
            type: payload.operationKind === 'inference' ? 'model' : 'tool',
          },
          causedByEventId,
          occurredAt: new Date().toISOString(),
          payloadSchema,
          payload,
          artifactRefs: [],
          security: {
            dataClassification: 'workspace',
            purpose: 'evaluation',
            allowedDestinations: ['documents', 'ai-train'],
            redactionApplied: true,
          },
          ...identity,
        } as any,
      ]);
      causedByEventId = eventId;
    };
    const reserveTool = (
      operationId: string,
      toolCallId: string,
      round: number,
    ) =>
      service.reserveOperationBudget(context.executionId, {
        executionId: context.executionId,
        loopId: context.executionId,
        grantId: grant.grantId,
        operationId,
        operationKind: 'tool_call',
        bucket: 'tool',
        toolCallId,
        operationFingerprint: fingerprint,
        operationFingerprintVersion: 'canonical_tool_input_v1',
        phase: 'agent_loop',
        round,
        name: 'folder_read',
        executionAttemptId: attemptId,
      });
    const firstOperationId = randomUUID();
    const firstToolCallId = randomUUID();
    const first = await reserveTool(firstOperationId, firstToolCallId, 1);
    causedByEventId = first.eventId;
    const firstAttemptId = randomUUID();
    await accept(
      'operation.started',
      'operation.started/1',
      {
        operationKind: 'tool_call',
        status: 'dispatched',
        name: 'folder_read',
        loopId: context.executionId,
        agentName: 'assistant',
        loopKind: 'top_level',
        round: 1,
        maxRounds: 2,
        phase: 'agent_loop',
        budgetGrantId: grant.grantId,
        budgetReservationId: first.reservation.reservationId,
        budgetBucket: 'tool',
        executionAttemptId: attemptId,
        operationFingerprint: fingerprint,
        operationFingerprintVersion: 'canonical_tool_input_v1',
      },
      {
        operationId: firstOperationId,
        attemptId: firstAttemptId,
        toolCallId: firstToolCallId,
      },
    );
    const firstSourceId = randomUUID();
    await accept(
      'source.observed',
      'source.observed/1',
      {
        sourceId: firstSourceId,
        kind: 'tool_output',
        originComponent: 'documents-models',
        observedAt: new Date().toISOString(),
        contentHash: resultFingerprint,
        trustLevel: 'tool_observation',
        dataClassification: 'workspace',
      },
      {
        operationId: firstOperationId,
        attemptId: firstAttemptId,
        toolCallId: firstToolCallId,
        sourceId: firstSourceId,
      },
    );
    await accept(
      'operation.finished',
      'operation.finished/1',
      {
        operationKind: 'tool_call',
        status: 'succeeded',
        result: { summary: 'Folder read' },
        error: null,
      },
      {
        operationId: firstOperationId,
        attemptId: firstAttemptId,
        toolCallId: firstToolCallId,
      },
    );

    const repeatedOperationId = randomUUID();
    const repeatedToolCallId = randomUUID();
    const decisions = await Promise.all([
      reserveTool(repeatedOperationId, repeatedToolCallId, 2),
      reserveTool(repeatedOperationId, repeatedToolCallId, 2),
    ]);
    expect(decisions.every((decision) => decision.granted)).toBe(true);
    expect(decisions[0].loopGuardSignal).toEqual(decisions[1].loopGuardSignal);
    expect(decisions[0].guardState).toMatchObject({
      detections: 1,
      warningIssued: true,
      warningPending: true,
    });
    const storedSignals = (
      await dataSource.getRepository(ExecutionEventEntity).find({
        where: { rootExecutionId: context.rootExecutionId },
      })
    ).filter(
      (event) =>
        (event.envelope.payload as Record<string, unknown>)?.kind ===
        'loop_guard_triggered',
    );
    expect(storedSignals).toHaveLength(1);

    causedByEventId = decisions[0].eventId;
    const repeatedAttemptId = randomUUID();
    await accept(
      'operation.started',
      'operation.started/1',
      {
        operationKind: 'tool_call',
        status: 'dispatched',
        name: 'folder_read',
        loopId: context.executionId,
        agentName: 'assistant',
        loopKind: 'top_level',
        round: 2,
        maxRounds: 3,
        phase: 'agent_loop',
        budgetGrantId: grant.grantId,
        budgetReservationId: decisions[0].reservation.reservationId,
        budgetBucket: 'tool',
        executionAttemptId: attemptId,
        operationFingerprint: fingerprint,
        operationFingerprintVersion: 'canonical_tool_input_v1',
      },
      {
        operationId: repeatedOperationId,
        attemptId: repeatedAttemptId,
        toolCallId: repeatedToolCallId,
      },
    );
    const repeatedSourceId = randomUUID();
    await accept(
      'source.observed',
      'source.observed/1',
      {
        sourceId: repeatedSourceId,
        kind: 'tool_output',
        originComponent: 'documents-models',
        observedAt: new Date().toISOString(),
        contentHash: resultFingerprint,
        trustLevel: 'tool_observation',
        dataClassification: 'workspace',
      },
      {
        operationId: repeatedOperationId,
        attemptId: repeatedAttemptId,
        toolCallId: repeatedToolCallId,
        sourceId: repeatedSourceId,
      },
    );
    await accept(
      'operation.finished',
      'operation.finished/1',
      {
        operationKind: 'tool_call',
        status: 'succeeded',
        result: { summary: 'Folder read' },
        error: null,
      },
      {
        operationId: repeatedOperationId,
        attemptId: repeatedAttemptId,
        toolCallId: repeatedToolCallId,
      },
    );

    const inferenceOperationId = randomUUID();
    const inference = await service.reserveOperationBudget(
      context.executionId,
      {
        executionId: context.executionId,
        loopId: context.executionId,
        grantId: grant.grantId,
        operationId: inferenceOperationId,
        operationKind: 'inference',
        bucket: 'normal',
        phase: 'agent_loop',
        round: 2,
        name: 'chat_with_tools',
        executionAttemptId: attemptId,
      },
    );
    causedByEventId = inference.eventId;
    const inferenceAttemptId = randomUUID();
    const inferencePayload = {
      operationKind: 'inference',
      status: 'dispatched',
      name: 'chat_with_tools',
      loopId: context.executionId,
      agentName: 'assistant',
      loopKind: 'top_level',
      round: 2,
      maxRounds: 2,
      phase: 'agent_loop',
      budgetGrantId: grant.grantId,
      budgetReservationId: inference.reservation.reservationId,
      budgetBucket: 'normal',
      executionAttemptId: attemptId,
    };
    await expect(
      accept('operation.started', 'operation.started/1', inferencePayload, {
        operationId: inferenceOperationId,
        attemptId: inferenceAttemptId,
      }),
    ).rejects.toThrow('Loop guard warning does not match');
    await accept(
      'operation.started',
      'operation.started/1',
      { ...inferencePayload, loopGuardWarningApplied: true },
      {
        operationId: inferenceOperationId,
        attemptId: inferenceAttemptId,
      },
    );
    const projected = await service.readProgress(
      context.rootExecutionId,
      scope,
    );
    expect(
      projected.ledger.loopGuards[grant.grantId].exactToolRepeat,
    ).toMatchObject({
      warningPending: false,
      warningAppliedToOperationId: inferenceOperationId,
    });

    const blockedOperationId = randomUUID();
    const blockedToolCallId = randomUUID();
    const blockedDecisions = await Promise.all([
      reserveTool(blockedOperationId, blockedToolCallId, 3),
      reserveTool(blockedOperationId, blockedToolCallId, 3),
    ]);
    expect(blockedDecisions.every((decision) => !decision.granted)).toBe(true);
    expect(blockedDecisions[0]).toMatchObject({
      reservation: {
        operationId: blockedOperationId,
        status: 'denied',
        reason: 'immediate_exact_tool_repeat_blocked',
      },
      loopGuardSignal: {
        action: 'block',
        previousOperationId: repeatedOperationId,
        triggeringOperationId: blockedOperationId,
        warningAppliedToOperationId: inferenceOperationId,
        operationFingerprint: fingerprint,
        resultFingerprint,
      },
      budgetState: {
        tool: { consumed: 2, available: 1 },
      },
      guardState: {
        detections: 2,
        blocks: 1,
        warningPending: false,
      },
    });
    expect(blockedDecisions[0].loopGuardSignal).toEqual(
      blockedDecisions[1].loopGuardSignal,
    );
    const finalEvents = await dataSource
      .getRepository(ExecutionEventEntity)
      .find({ where: { rootExecutionId: context.rootExecutionId } });
    expect(
      finalEvents.filter(
        (event) =>
          (event.envelope.payload as Record<string, unknown>)?.kind ===
          'loop_guard_triggered',
      ),
    ).toHaveLength(2);
    expect(
      finalEvents.some(
        (event) =>
          event.envelope.eventType === 'operation.started' &&
          event.envelope.operationId === blockedOperationId,
      ),
    ).toBe(false);
  });

  it('validates, fences, finalizes, and replays a deterministic partial', async () => {
    const scope = { ownerPrincipal: 'e2e-user', workspaceId: 'e2e-workspace' };
    const context = await service.createForChat(
      'assistant_chat',
      'materialize a deterministic partial',
      scope,
      {},
    );
    const attemptId = randomUUID();
    await activateStepAttempt(context.executionId, attemptId);
    const requestedPolicy = {
      normal: 1,
      normalInferenceSoftLimit: 0,
      repair: 0,
      closing: 1,
      maxTokensPerInference: 128,
      toolCalls: 1,
      toolCallSoftLimit: 0,
      exactToolRepeatWarning: true,
    };
    const { grant } = await service.requestProgressGrant(context.executionId, {
      executionId: context.executionId,
      turnId: context.turnId,
      loopId: context.executionId,
      agentName: 'assistant',
      loopKind: 'top_level',
      executionAttemptId: attemptId,
      requestedPolicy,
    });
    const repository = dataSource.getRepository(ExecutionEntity);
    let causedByEventId = (
      await repository.findOneByOrFail({
        executionId: context.executionId,
      })
    ).lastEventId;
    let producerSequence = 0;
    const accept = async (
      eventType: string,
      payloadSchema: string,
      payload: Record<string, unknown>,
      identity: Record<string, unknown> = {},
      actor: Record<string, unknown> = { type: 'worker' },
    ) => {
      const eventId = randomUUID();
      await service.acceptEvents(context.rootExecutionId, [
        {
          eventId,
          rootExecutionId: context.rootExecutionId,
          executionId: context.executionId,
          turnId: context.turnId,
          producerSequence: ++producerSequence,
          eventType,
          producer: {
            component: 'documents-models',
            instanceId: `mvp09-${attemptId}`,
            version: 'test',
          },
          actor,
          causedByEventId,
          occurredAt: new Date().toISOString(),
          payloadSchema,
          payload,
          artifactRefs: [],
          security: {
            dataClassification: 'workspace',
            purpose: 'evaluation',
            allowedDestinations: ['documents', 'ai-train'],
            redactionApplied: true,
          },
          ...identity,
        } as any,
      ]);
      causedByEventId = eventId;
    };
    const refreshCause = async () => {
      causedByEventId = (
        await repository.findOneByOrFail({
          executionId: context.executionId,
        })
      ).lastEventId;
    };

    const normalOperationId = randomUUID();
    const normalAttemptId = randomUUID();
    const normalReservation = await service.reserveOperationBudget(
      context.executionId,
      {
        executionId: context.executionId,
        loopId: context.executionId,
        grantId: grant.grantId,
        operationId: normalOperationId,
        operationKind: 'inference',
        bucket: 'normal',
        phase: 'agent_loop',
        round: 1,
        name: 'chat_with_tools',
        executionAttemptId: attemptId,
      },
    );
    await refreshCause();
    await accept(
      'operation.started',
      'operation.started/1',
      {
        operationKind: 'inference',
        status: 'dispatched',
        name: 'chat_with_tools',
        loopId: context.executionId,
        agentName: 'assistant',
        loopKind: 'top_level',
        round: 1,
        maxRounds: 1,
        phase: 'agent_loop',
        budgetGrantId: grant.grantId,
        budgetReservationId: normalReservation.reservation.reservationId,
        budgetBucket: 'normal',
        executionAttemptId: attemptId,
      },
      { operationId: normalOperationId, attemptId: normalAttemptId },
      { type: 'model' },
    );
    await accept(
      'operation.finished',
      'operation.finished/1',
      {
        operationKind: 'inference',
        status: 'succeeded',
        outcome: 'tool_requests',
        result: { content: '', tool_calls: 1 },
        error: null,
      },
      { operationId: normalOperationId, attemptId: normalAttemptId },
      { type: 'model' },
    );

    const toolOperationId = randomUUID();
    const toolAttemptId = randomUUID();
    const toolCallId = randomUUID();
    const toolReservation = await service.reserveOperationBudget(
      context.executionId,
      {
        executionId: context.executionId,
        loopId: context.executionId,
        grantId: grant.grantId,
        operationId: toolOperationId,
        operationKind: 'tool_call',
        bucket: 'tool',
        toolCallId,
        phase: 'agent_loop',
        round: 1,
        name: 'folder_read',
        executionAttemptId: attemptId,
      },
    );
    await refreshCause();
    await accept(
      'operation.started',
      'operation.started/1',
      {
        operationKind: 'tool_call',
        status: 'dispatched',
        name: 'folder_read',
        inputSummary: { path: 'fixture.txt' },
        loopId: context.executionId,
        agentName: 'assistant',
        loopKind: 'top_level',
        round: 1,
        maxRounds: 1,
        phase: 'agent_loop',
        budgetGrantId: grant.grantId,
        budgetReservationId: toolReservation.reservation.reservationId,
        budgetBucket: 'tool',
        executionAttemptId: attemptId,
      },
      {
        operationId: toolOperationId,
        attemptId: toolAttemptId,
        toolCallId,
      },
    );
    await accept(
      'operation.finished',
      'operation.finished/1',
      {
        operationKind: 'tool_call',
        status: 'succeeded',
        result: { path: 'fixture.txt' },
        resultSummary: 'Document read',
        resultSummaryKind: 'leaf_tool',
        error: null,
      },
      {
        operationId: toolOperationId,
        attemptId: toolAttemptId,
        toolCallId,
      },
    );

    const closingOperationId = randomUUID();
    const closingAttemptId = randomUUID();
    const closingReservation = await service.reserveOperationBudget(
      context.executionId,
      {
        executionId: context.executionId,
        loopId: context.executionId,
        grantId: grant.grantId,
        operationId: closingOperationId,
        operationKind: 'inference',
        bucket: 'closing',
        phase: 'forced_finalization',
        round: 1,
        name: 'forced_finalization',
        executionAttemptId: attemptId,
      },
    );
    await refreshCause();
    await accept(
      'operation.started',
      'operation.started/1',
      {
        operationKind: 'inference',
        status: 'dispatched',
        name: 'forced_finalization',
        loopId: context.executionId,
        agentName: 'assistant',
        loopKind: 'top_level',
        round: 1,
        maxRounds: 1,
        phase: 'forced_finalization',
        budgetGrantId: grant.grantId,
        budgetReservationId: closingReservation.reservation.reservationId,
        budgetBucket: 'closing',
        executionAttemptId: attemptId,
      },
      { operationId: closingOperationId, attemptId: closingAttemptId },
      { type: 'model' },
    );
    await accept(
      'operation.finished',
      'operation.finished/1',
      {
        operationKind: 'inference',
        status: 'succeeded',
        outcome: 'invalid',
        reason: 'empty_model_response',
        result: { content: '' },
        error: null,
      },
      { operationId: closingOperationId, attemptId: closingAttemptId },
      { type: 'model' },
    );

    const reply = [
      "I couldn't produce the final synthesis because this turn reached its execution limit.",
      '',
      'Completed work:',
      '- Folder read: Document read',
      '',
      'Pending:',
      '- Final synthesis of the completed results.',
    ].join('\n');
    const finalArtifactId = randomUUID();
    const finalBody = Buffer.from(reply, 'utf8');
    await service.acceptArtifacts(context.rootExecutionId, [
      {
        artifactId: finalArtifactId,
        kind: 'model_response',
        contentHash: contentHash(finalBody),
        size: finalBody.length,
        mediaType: 'text/plain',
        encoding: 'identity',
        dataClassification: 'workspace',
        redaction: { applied: false },
        retentionClass: 'evaluation',
        inputSourceIds: [],
        bodyBase64: finalBody.toString('base64'),
      },
    ]);
    await accept(
      'message.recorded',
      'message.recorded/1',
      {
        messageKind: 'final_response',
        role: 'assistant',
        contentPreview: reply,
        contentArtifactId: finalArtifactId,
        format: 'text',
        generationSource: 'runtime_template',
      },
      { artifactRefs: [finalArtifactId] },
      { type: 'system' },
    );
    const completion = {
      kind: 'partial' as const,
      reason: 'budget_exhausted',
      source: 'runtime_template' as const,
      partialResult: {
        version: '1' as const,
        trigger: 'closing_output_empty' as const,
        loopId: context.executionId,
        grantId: grant.grantId,
        executionAttemptId: attemptId,
        completedOperations: [
          {
            operationId: toolOperationId,
            toolCallId,
            name: 'folder_read',
            summary: 'Document read',
          },
        ],
        pending: ['final_synthesis'] as ['final_synthesis'],
      },
    };

    await expect(
      service.validateDeterministicPartial(
        context.executionId,
        reply,
        null,
        completion,
      ),
    ).resolves.toBeUndefined();
    const staleAttemptId = randomUUID();
    await activateStepAttempt(context.executionId, staleAttemptId);
    await expect(
      service.completeExecution(
        context.executionId,
        reply,
        null,
        undefined,
        completion,
      ),
    ).rejects.toThrow('Execution attempt is not active');
    await activateStepAttempt(context.executionId, attemptId);

    await service.completeExecution(
      context.executionId,
      reply,
      null,
      undefined,
      completion,
    );
    const completed = await service.findOne(context.executionId);
    expect(completed).toMatchObject({
      status: 'completed',
      completionKind: 'partial',
      completionReason: 'budget_exhausted',
      error: null,
      result: { reply },
    });
    const eventsBeforeReplay = await dataSource
      .getRepository(ExecutionEventEntity)
      .countBy({ rootExecutionId: context.rootExecutionId });
    await service.completeExecution(
      context.executionId,
      reply,
      null,
      undefined,
      completion,
    );
    const eventsAfterReplay = await dataSource
      .getRepository(ExecutionEventEntity)
      .countBy({ rootExecutionId: context.rootExecutionId });
    expect(eventsAfterReplay).toBe(eventsBeforeReplay);
    const terminal = await dataSource
      .getRepository(ExecutionEventEntity)
      .findOneByOrFail({
        rootExecutionId: context.rootExecutionId,
        eventType: 'execution.state_changed',
        sequence: String(eventsBeforeReplay),
      });
    expect(terminal.envelope.payload).toMatchObject({
      to: 'completed',
      completionKind: 'partial',
      completionReason: 'budget_exhausted',
      completionSource: 'runtime_template',
      partialResult: completion.partialResult,
      result: { reply },
      error: null,
    });
  });
});

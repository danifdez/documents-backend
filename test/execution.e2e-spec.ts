import { randomUUID } from 'crypto';
import { config as loadEnv } from 'dotenv';
import { DataSource, In } from 'typeorm';
import { CreateExecutions1757668140001 } from '../migrations/1757668140001-CreateExecutions';
import { AddExecutionProgress1757668140350 } from '../migrations/1757668140350-AddExecutionProgress';
import { CreateExecutionControlPlane1757668140370 } from '../migrations/1757668140370-CreateExecutionControlPlane';
import { AddWorkerCredentials1757668140380 } from '../migrations/1757668140380-AddWorkerCredentials';
import { CreateExecutionOutbox1757668140400 } from '../migrations/1757668140400-CreateExecutionOutbox';
import { CreateExecutionOperations1757668140410 } from '../migrations/1757668140410-CreateExecutionOperations';
import { CreateExecutionToolPlans1757668140420 } from '../migrations/1757668140420-CreateExecutionToolPlans';
import { AddExecutionStepContinuation1757668140430 } from '../migrations/1757668140430-AddExecutionStepContinuation';
import { AddExecutionStepContinuationTarget1757668140440 } from '../migrations/1757668140440-AddExecutionStepContinuationTarget';
import { DropObsoleteExecutionCheckpoint1757668140450 } from '../migrations/1757668140450-DropObsoleteExecutionCheckpoint';
import { DropObsoleteExecutionRoutingFields1757668140460 } from '../migrations/1757668140460-DropObsoleteExecutionRoutingFields';
import { AddExecutionStepFailureFinalization1757668140470 } from '../migrations/1757668140470-AddExecutionStepFailureFinalization';
import { AddExecutionOutputArtifacts1757668140600 } from '../migrations/1757668140600-AddExecutionOutputArtifacts';
import { AddWorkerConcurrency1757668140700 } from '../migrations/1757668140700-AddWorkerConcurrency';
import { RemoveExecutionWorkspaceScope1757668140710 } from '../migrations/1757668140710-RemoveExecutionWorkspaceScope';
import { CreateExecutionConfirmations1757668140720 } from '../migrations/1757668140720-CreateExecutionConfirmations';
import { AddExecutionCancellation1757668140740 } from '../migrations/1757668140740-AddExecutionCancellation';
import { AddWorkerIdentityScope1757668140750 } from '../migrations/1757668140750-AddWorkerIdentityScope';
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
  canonicalHash,
  contentHash,
  ExecutionService,
} from '../src/execution/execution.service';
import { WorkerEntity } from '../src/worker/worker.entity';
import { WorkerService } from '../src/worker/worker.service';
import { WorkerKind } from '../src/worker/worker-kind.enum';
import { ExecutionOutboxEntity } from '../src/execution-outbox/execution-outbox.entity';
import { ExecutionOperationEntity } from '../src/execution/execution-operation.entity';
import { ExecutionOperationStatus } from '../src/execution/execution-operation-status.enum';
import { ExecutionToolInvocationEntity } from '../src/execution/execution-tool-invocation.entity';
import { ExecutionToolPlanEntity } from '../src/execution/execution-tool-plan.entity';
import { ExecutionToolPlanService } from '../src/execution/execution-tool-plan.service';
import { ExecutionConfirmationEntity } from '../src/execution/execution-confirmation.entity';
import { ExecutionConfirmationService } from '../src/execution/execution-confirmation.service';
import { ExecutionToolRuntimeService } from '../src/execution-coordinator/execution-tool-runtime.service';
import { ExecutionAgentLoopService } from '../src/execution-coordinator/execution-agent-loop.service';
import {
  assertOperationBudgetProjection,
  governedBudgetStart,
} from '../src/execution/inference-budget-policy';

const TEST_RUNTIME_FINGERPRINT = `sha256:${'a'.repeat(64)}`;
const TEST_CODE_FINGERPRINT = `sha256:${'b'.repeat(64)}`;
import {
  exactToolRepeatGuardSnapshot,
  ProgressEvent,
  projectExecutionProgress,
} from '../src/execution/execution-progress';
import { ExecutionProgressService } from '../src/execution/execution-progress.service';

loadEnv({ path: '.env' });

describe('execution PostgreSQL integration', () => {
  const schema = `execution_test_${randomUUID().replaceAll('-', '_')}`;
  let dataSource: DataSource;
  let service: ExecutionService;
  let budgets: ExecutionProgressService;
  let attemptService: ExecutionAttemptService;
  let workerService: WorkerService;
  let toolPlanService: ExecutionToolPlanService;
  let confirmationService: ExecutionConfirmationService;
  let agentLoopService: ExecutionAgentLoopService;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.POSTGRES_HOST,
      port: Number(process.env.POSTGRES_PORT),
      username: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DB,
      schema,
      extra: { options: `-c search_path=${schema}` },
      synchronize: false,
      entities: [
        ExecutionEntity,
        ExecutionEventEntity,
        ExecutionArtifactEntity,
        ExecutionStepEntity,
        ExecutionStepDependencyEntity,
        ExecutionStepAttemptEntity,
        ExecutionResultReceiptEntity,
        ExecutionOutboxEntity,
        ExecutionOperationEntity,
        ExecutionToolInvocationEntity,
        ExecutionToolPlanEntity,
        ExecutionConfirmationEntity,
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
    await new CreateExecutionOutbox1757668140400().up(runner);
    await new CreateExecutionOperations1757668140410().up(runner);
    await new CreateExecutionToolPlans1757668140420().up(runner);
    await new AddExecutionStepContinuation1757668140430().up(runner);
    await new AddExecutionStepContinuationTarget1757668140440().up(runner);
    await new DropObsoleteExecutionCheckpoint1757668140450().up(runner);
    await new DropObsoleteExecutionRoutingFields1757668140460().up(runner);
    await new AddExecutionStepFailureFinalization1757668140470().up(runner);
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
    await new AddExecutionOutputArtifacts1757668140600().up(runner);
    await new AddWorkerConcurrency1757668140700().up(runner);
    await new RemoveExecutionWorkspaceScope1757668140710().up(runner);
    await new CreateExecutionConfirmations1757668140720().up(runner);
    await new AddExecutionCancellation1757668140740().up(runner);
    await new AddWorkerIdentityScope1757668140750().up(runner);
    await runner.release();

    const config = {
      get: (_key: string, fallback?: unknown) => fallback,
    } as any;
    budgets = new ExecutionProgressService(dataSource, config);
    service = new ExecutionService(
      dataSource,
      dataSource.getRepository(ExecutionEntity),
      dataSource.getRepository(ExecutionEventEntity),
      dataSource.getRepository(ExecutionArtifactEntity),
      config,
      new ExecutionContractValidator(),
      budgets,
    );
    attemptService = new ExecutionAttemptService(
      dataSource,
      new ExecutionContractValidator(),
    );
    workerService = new WorkerService(
      dataSource.getRepository(WorkerEntity),
      dataSource.getRepository(ExecutionStepAttemptEntity),
    );
    confirmationService = new ExecutionConfirmationService(
      dataSource,
      new ExecutionContractValidator(),
    );
    toolPlanService = new ExecutionToolPlanService(
      dataSource,
      new ExecutionContractValidator(),
      confirmationService,
      service,
    );
    agentLoopService = new ExecutionAgentLoopService(
      dataSource,
      budgets,
      toolPlanService,
    );
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

  it('does not retain obsolete execution control columns', async () => {
    const columns = await dataSource.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'executions'
        AND column_name IN (
          'checkpoint',
          'origin',
          'priority',
          'workspace_id'
        )
    `);
    expect(columns).toEqual([]);
  });

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
    const initialStep = await dataSource
      .getRepository(ExecutionStepEntity)
      .findOneByOrFail({
        executionId: created.executionId,
      });
    expect(initialStep).toMatchObject({
      executionId: created.executionId,
      schemaVersion: 'step/1',
      stepKind: ExecutionStepKind.CODE,
      status: 'ready',
      work: { taskType: 'detect-language', content: 'Hello' },
    });
    await expect(
      dataSource.getRepository(ExecutionOperationEntity).findOneByOrFail({
        operationId: initialStep.operationId,
      }),
    ).resolves.toMatchObject({
      executionId: created.executionId,
      stepId: initialStep.stepId,
      operationId: initialStep.operationId,
      schemaVersion: 'operation/1',
      status: ExecutionOperationStatus.PREPARED,
      causedByEventId: created.lastEventId,
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

  it('persists one-shot model work as an inference step', async () => {
    const payload = {
      sourceLanguage: 'en',
      targetLanguage: 'es',
      texts: ['Hello'],
    };
    const created = await service.createInference(
      'translate',
      ExecutionPriority.NORMAL,
      payload,
    );

    await expect(
      dataSource.getRepository(ExecutionStepEntity).findOneByOrFail({
        executionId: created.executionId,
      }),
    ).resolves.toMatchObject({
      stepKind: ExecutionStepKind.INFERENCE,
      work: { taskType: 'translate', payload },
      requiredCapabilities: ['translate'],
    });
  });

  it('persists domain reconciliation policy for failed steps', async () => {
    const payload = { datasetId: 3, recordId: 5 };
    const created = await service.createInference(
      'dataset.extract-row',
      ExecutionPriority.NORMAL,
      payload,
      { finalizeOnFailure: true },
    );

    await expect(
      dataSource.getRepository(ExecutionStepEntity).findOneByOrFail({
        executionId: created.executionId,
      }),
    ).resolves.toMatchObject({
      stepKind: ExecutionStepKind.INFERENCE,
      finalizeOnFailure: true,
    });
  });

  it('preserves tree identity and artifacts for child inference work', async () => {
    const parent = await service.create(
      'document-extraction',
      ExecutionPriority.NORMAL,
      { resourceId: 7 },
    );
    const media = Buffer.from('media-body');
    const child = await service.createInference(
      'transcribe',
      ExecutionPriority.BACKGROUND,
      { resourceId: 7, extension: '.wav' },
      {
        rootExecutionId: parent.rootExecutionId,
        parentExecutionId: parent.executionId,
        ownerPrincipal: parent.ownerPrincipal,
        inputArtifacts: [
          {
            role: 'media',
            kind: 'source_media',
            mediaType: 'audio/wav',
            body: media,
          },
        ],
      },
    );

    expect(child).toMatchObject({
      rootExecutionId: parent.rootExecutionId,
      parentExecutionId: parent.executionId,
      ownerPrincipal: parent.ownerPrincipal,
    });
    const step = await dataSource
      .getRepository(ExecutionStepEntity)
      .findOneByOrFail({ executionId: child.executionId });
    expect(step).toMatchObject({
      stepKind: ExecutionStepKind.INFERENCE,
      inputArtifactRefs: [{ role: 'media' }],
    });
    const artifact = await dataSource
      .getRepository(ExecutionArtifactEntity)
      .createQueryBuilder('artifact')
      .addSelect('artifact.body')
      .where('artifact.artifact_id = :artifactId', {
        artifactId: step.inputArtifactRefs[0].artifactId,
      })
      .getOneOrFail();
    expect(artifact).toMatchObject({
      rootExecutionId: parent.rootExecutionId,
      kind: 'source_media',
      mediaType: 'audio/wav',
      body: media,
    });

    const workerId = randomUUID();
    const assignment = await attemptService.claimReadyStep({
      workerId,
      stepKinds: [ExecutionStepKind.INFERENCE],
      capabilities: ['transcribe'],
      leaseDurationMs: 30_000,
    });
    expect(assignment).toMatchObject({
      executionId: child.executionId,
      stepId: step.stepId,
      inputArtifactRefs: [{ role: 'media' }],
    });
    await attemptService.startAttempt(assignment!.attemptId, workerId);
    await attemptService.receiveResult({
      executionId: assignment!.executionId,
      stepId: assignment!.stepId,
      operationId: assignment!.operationId,
      attemptId: assignment!.attemptId,
      workerId,
      result: {
        schemaVersion: 'step-result/1',
        executionId: assignment!.executionId,
        stepId: assignment!.stepId,
        operationId: assignment!.operationId,
        attemptId: assignment!.attemptId,
        stepKind: ExecutionStepKind.INFERENCE,
        status: 'succeeded',
        output: {
          kind: ExecutionStepKind.INFERENCE,
          outcome: {
            kind: 'structured_result',
            schemaId: 'transcribe-output/1',
            value: { transcript: 'Hello' },
          },
        },
        codeFingerprint: TEST_CODE_FINGERPRINT,
        runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
        usage: {
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
        },
        inference: {
          effectiveModel: 'e2e-whisper',
          effectiveAdapter: null,
          effectivePromptPackages: ['transcribe/1'],
          finishReason: 'completed',
          inferenceMs: 1,
          cacheOutcome: 'unknown',
          warnings: [],
        },
        artifactRefs: [],
        error: null,
      },
    });
    await expect(attemptService.processReceivedResults()).resolves.toBe(1);

    const treeEvents = await dataSource
      .getRepository(ExecutionEventEntity)
      .find({
        where: { rootExecutionId: parent.rootExecutionId },
        order: { sequence: 'ASC' },
      });
    expect(treeEvents.map((event) => event.sequence)).toEqual([
      '1',
      '2',
      '3',
      '4',
    ]);
    expect(treeEvents.map((event) => event.eventType)).toEqual([
      'execution.created',
      'execution.created',
      'operation.started',
      'operation.finished',
    ]);
    const persistedRoot = await dataSource
      .getRepository(ExecutionEntity)
      .findOneByOrFail({ executionId: parent.executionId });
    const persistedChild = await dataSource
      .getRepository(ExecutionEntity)
      .findOneByOrFail({ executionId: child.executionId });
    expect(persistedRoot.lastSequence).toBe('4');
    expect(persistedRoot.lastEventId).toBe(treeEvents[3].eventId);
    expect(persistedChild).toMatchObject({
      phase: 'backend_finalization',
      result: { transcript: 'Hello' },
      lastSequence: '4',
      lastEventId: treeEvents[3].eventId,
    });
  });

  it('propagates durable cancellation through active child attempts', async () => {
    const ownerPrincipal = 'cancellation-tree-e2e';
    const parent = await service.create(
      'document-extraction',
      ExecutionPriority.NORMAL,
      { resourceId: 9 },
      { ownerPrincipal },
    );
    const child = await service.createInference(
      'transcribe',
      ExecutionPriority.NORMAL,
      { resourceId: 9 },
      {
        rootExecutionId: parent.executionId,
        parentExecutionId: parent.executionId,
        ownerPrincipal,
      },
    );
    const childStep = await dataSource
      .getRepository(ExecutionStepEntity)
      .findOneByOrFail({ executionId: child.executionId });
    const workerId = randomUUID();
    const attempt = await attemptService.grantAttempt({
      stepId: childStep.stepId,
      workerId,
      leaseDurationMs: 30_000,
    });

    await expect(
      service.requestCancellation(
        parent.executionId,
        { ownerPrincipal },
        'User stopped the execution',
      ),
    ).resolves.toMatchObject({
      rootExecutionId: parent.executionId,
      status: ExecutionStatus.QUEUED,
      cancellationReason: 'User stopped the execution',
    });
    await expect(
      attemptService.readAttemptControl(attempt.attemptId, workerId),
    ).resolves.toMatchObject({ cancelled: true });
    await expect(
      dataSource
        .getRepository(ExecutionStepEntity)
        .findOneByOrFail({ executionId: parent.executionId }),
    ).resolves.toMatchObject({ status: ExecutionStepStatus.CANCELLED });
    await expect(
      dataSource
        .getRepository(ExecutionStepEntity)
        .findOneByOrFail({ executionId: child.executionId }),
    ).resolves.toMatchObject({ status: ExecutionStepStatus.RUNNING });
    await expect(service.reconcileRequestedCancellations()).resolves.toBe(0);

    await expect(
      attemptService.expireAttempt(
        attempt.attemptId,
        new Date(attempt.leaseExpiresAt.getTime() + 1),
      ),
    ).resolves.toBe(true);
    await expect(service.finalizePendingTerminals()).resolves.toBe(1);
    await expect(service.reconcileRequestedCancellations()).resolves.toBe(1);

    const executions = await dataSource.getRepository(ExecutionEntity).find({
      where: { rootExecutionId: parent.executionId },
    });
    expect(executions).toHaveLength(2);
    expect(executions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          executionId: parent.executionId,
          status: ExecutionStatus.CANCELLED,
          cancellationReason: 'User stopped the execution',
        }),
        expect.objectContaining({
          executionId: child.executionId,
          status: ExecutionStatus.CANCELLED,
          cancellationReason: 'User stopped the execution',
        }),
      ]),
    );
    await expect(
      dataSource
        .getRepository(ExecutionOperationEntity)
        .findOneByOrFail({ operationId: childStep.operationId }),
    ).resolves.toMatchObject({
      status: ExecutionOperationStatus.CANCELLED,
      currentAttemptId: null,
    });
    const cancellationEvents = await dataSource
      .getRepository(ExecutionEventEntity)
      .find({
        where: { rootExecutionId: parent.executionId },
        order: { sequence: 'ASC' },
      });
    const validator = new ExecutionContractValidator();
    for (const event of cancellationEvents) {
      validator.assertEvent(event.envelope);
    }
    expect(
      cancellationEvents.filter(
        (event) =>
          event.eventType === 'execution.state_changed' &&
          (event.envelope.payload as Record<string, unknown> | undefined)
            ?.phase === 'cancellation_requested',
      ),
    ).toHaveLength(2);
  });

  it('commits terminal state, event and publication in one transaction', async () => {
    const created = await service.create('ask', ExecutionPriority.NORMAL, {
      requestId: 'request-1',
    });

    await service.markAsCompleted(created.executionId, {
      publication: {
        socketEvent: 'askResponse',
        payload: { response: 'done', requestId: 'request-1' },
      },
    });

    const terminal = await dataSource
      .getRepository(ExecutionEntity)
      .findOneByOrFail({ executionId: created.executionId });
    const publication = await dataSource
      .getRepository(ExecutionOutboxEntity)
      .findOneByOrFail({ executionId: created.executionId });
    expect(terminal.status).toBe(ExecutionStatus.COMPLETED);
    expect(publication).toMatchObject({
      eventId: terminal.lastEventId,
      schemaVersion: 'execution-outbox/1',
      socketEvent: 'askResponse',
      payload: { response: 'done', requestId: 'request-1' },
      status: 'pending',
    });
  });

  it('prepares a durable tool plan without creating executable work', async () => {
    const created = await service.create(
      'tool-plan-test',
      ExecutionPriority.NORMAL,
      {},
    );
    const stepsBefore = await dataSource
      .getRepository(ExecutionStepEntity)
      .countBy({ executionId: created.executionId });
    const toolCallId = randomUUID();
    const request = {
      schemaVersion: 'tool-invocation/1' as const,
      toolCallId,
      name: 'documents.search',
      arguments: { query: '  harness  ', limit: 5 },
      requester: {
        kind: 'deterministic' as const,
        component: 'documents-backend',
      },
      executionContext: {
        executionId: created.executionId,
        causedByEventId: created.lastEventId!,
        phase: 'tool',
        dataClassification: 'workspace' as const,
      },
    };

    const prepared = await toolPlanService.prepare(request);
    const repeated = await toolPlanService.prepare(request);

    expect(prepared.duplicate).toBe(false);
    expect(repeated).toMatchObject({
      duplicate: true,
      plan: { operationId: prepared.plan.operationId, stepId: null },
    });
    await expect(
      dataSource.getRepository(ExecutionStepEntity).countBy({
        executionId: created.executionId,
      }),
    ).resolves.toBe(stepsBefore);
    await expect(
      dataSource.getRepository(ExecutionToolPlanEntity).findOneByOrFail({
        toolCallId,
      }),
    ).resolves.toMatchObject({
      operationId: prepared.plan.operationId,
      schemaVersion: 'tool-plan/1',
      stepId: null,
      plan: {
        normalizedArguments: { query: 'harness', limit: 5 },
        policyDecision: { decision: 'allowed', rule: 'local_documents_read' },
      },
    });
  });

  it('persists, publishes and decides a confirmation tied to the exact tool plan', async () => {
    const ownerPrincipal = 'confirmation-e2e';
    const created = await service.create(
      'tool-plan-test',
      ExecutionPriority.NORMAL,
      { ownerId: 42 },
      { ownerPrincipal },
    );
    const toolCallId = randomUUID();
    const prepared = await toolPlanService.prepare({
      schemaVersion: 'tool-invocation/1',
      toolCallId,
      name: 'user_tasks.create',
      arguments: { title: 'Review harness evidence', description: 'E2E' },
      requester: {
        kind: 'deterministic',
        component: 'documents-backend',
      },
      executionContext: {
        executionId: created.executionId,
        causedByEventId: created.lastEventId!,
        phase: 'agent_loop',
        dataClassification: 'workspace',
      },
    });

    expect(prepared.plan.plan.policyDecision.decision).toBe(
      'confirmation_required',
    );
    await expect(
      toolPlanService.materialize(toolCallId, randomUUID()),
    ).resolves.toBeNull();
    await expect(
      confirmationService.activatePending(created.executionId),
    ).resolves.toBe(1);

    const waiting = await dataSource
      .getRepository(ExecutionEntity)
      .findOneByOrFail({ executionId: created.executionId });
    expect(waiting).toMatchObject({
      status: ExecutionStatus.WAITING,
      phase: 'awaiting_confirmation',
      waitReason: 'confirmation',
      resumePhase: 'agent_loop',
    });
    const pending = await confirmationService.listPending({ ownerPrincipal });
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      ownerId: 42,
      taskType: 'tool-plan-test',
      confirmation: {
        operationId: prepared.plan.operationId,
        toolCallId,
        planHash: prepared.plan.planHash,
        status: 'pending',
      },
    });

    const decided = await confirmationService.decide(
      pending[0].confirmation.confirmationId,
      'approved',
      { ownerPrincipal },
    );
    expect(decided).toMatchObject({
      planHash: prepared.plan.planHash,
      status: 'approved',
    });
    const resumed = await dataSource
      .getRepository(ExecutionEntity)
      .findOneByOrFail({ executionId: created.executionId });
    expect(resumed).toMatchObject({
      status: ExecutionStatus.QUEUED,
      phase: 'agent_loop',
      waitReason: null,
      waitCondition: null,
      resumePhase: null,
      waitExpiresAt: null,
    });
    const events = await dataSource.getRepository(ExecutionEventEntity).find({
      where: { executionId: created.executionId },
      order: { sequence: 'ASC' },
    });
    expect(events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        'confirmation.requested',
        'confirmation.decided',
      ]),
    );
    const publications = await dataSource
      .getRepository(ExecutionOutboxEntity)
      .find({ where: { executionId: created.executionId } });
    expect(publications.map((publication) => publication.socketEvent)).toEqual(
      expect.arrayContaining([
        'executionConfirmationRequested',
        'executionConfirmationDecided',
      ]),
    );
  });

  it('expires a requested confirmation and resumes it as not executable', async () => {
    const ownerPrincipal = 'confirmation-expiry-e2e';
    const created = await service.create(
      'tool-plan-test',
      ExecutionPriority.NORMAL,
      {},
      { ownerPrincipal },
    );
    const prepared = await toolPlanService.prepare({
      schemaVersion: 'tool-invocation/1',
      toolCallId: randomUUID(),
      name: 'user_tasks.create',
      arguments: { title: 'Expired task' },
      requester: {
        kind: 'deterministic',
        component: 'documents-backend',
      },
      executionContext: {
        executionId: created.executionId,
        causedByEventId: created.lastEventId!,
        phase: 'agent_loop',
        dataClassification: 'workspace',
      },
    });
    await confirmationService.activatePending(created.executionId);
    const repository = dataSource.getRepository(ExecutionConfirmationEntity);
    const confirmation = await repository.findOneByOrFail({
      operationId: prepared.plan.operationId,
    });
    confirmation.expiresAt = new Date(Date.now() - 1_000);
    await repository.save(confirmation);

    await expect(confirmationService.expirePending()).resolves.toBe(1);
    await expect(
      repository.findOneByOrFail({
        confirmationId: confirmation.confirmationId,
      }),
    ).resolves.toMatchObject({ status: 'expired', decidedBy: null });
    await expect(
      dataSource
        .getRepository(ExecutionEntity)
        .findOneByOrFail({ executionId: created.executionId }),
    ).resolves.toMatchObject({
      status: ExecutionStatus.QUEUED,
      phase: 'agent_loop',
      waitReason: null,
    });
  });

  it('creates, joins and incorporates a bounded durable child execution', async () => {
    const created = await service.createForChat(
      'assistant_chat',
      'Delegate a focused comparison',
      { ownerPrincipal: 'delegation-e2e' },
      { ownerId: 1, conversation: [] },
    );
    const initialStep = await dataSource
      .getRepository(ExecutionStepEntity)
      .findOneByOrFail({ executionId: created.executionId });
    initialStep.status = ExecutionStepStatus.COMPLETED;
    await dataSource.getRepository(ExecutionStepEntity).save(initialStep);
    const { grant } = await budgets.requestProgressGrant(created.executionId, {
      executionId: created.executionId,
      turnId: created.turnId!,
      loopId: created.executionId,
      agentName: 'assistant',
      loopKind: 'top_level',
      requestedPolicy: {
        normal: 3,
        normalInferenceSoftLimit: 2,
        repair: 1,
        closing: 1,
        maxTokensPerInference: 512,
        toolCalls: 3,
        toolCallSoftLimit: 2,
        exactToolRepeatWarning: false,
        exactToolRepeatBlockAfterWarning: false,
        exactToolRepeatTerminateAfterBlock: false,
      },
    });
    const toolCallId = randomUUID();
    const prepared = await toolPlanService.prepare({
      schemaVersion: 'tool-invocation/1',
      toolCallId,
      name: 'agents.delegate',
      arguments: { goal: 'Compare evidence A with evidence B' },
      requester: { kind: 'deterministic', component: 'documents-backend' },
      executionContext: {
        executionId: created.executionId,
        turnId: created.turnId!,
        causedByEventId: created.lastEventId!,
        phase: 'agent_loop',
        dataClassification: 'workspace',
      },
    });
    const reservation = await budgets.reserveOperationBudget(
      created.executionId,
      {
        executionId: created.executionId,
        loopId: created.executionId,
        grantId: grant.grantId,
        operationId: prepared.plan.operationId,
        operationKind: 'tool_call',
        bucket: 'tool',
        toolCallId,
        operationFingerprint: canonicalHash({
          name: 'agents.delegate',
          arguments: { goal: 'Compare evidence A with evidence B' },
        }),
        operationFingerprintVersion: 'canonical_tool_input_v1',
        toolBatchSize: 1,
        toolBatchIndex: 0,
        phase: 'agent_loop',
        round: 1,
        name: 'agents.delegate',
      },
    );
    const parentToolStep = await toolPlanService.materialize(
      toolCallId,
      reservation.reservation.reservationId,
    );
    expect(parentToolStep).toMatchObject({
      status: ExecutionStepStatus.BLOCKED,
      work: {
        taskType: 'agents.delegate',
        joinPolicy: 'all',
        delegationDepth: 1,
      },
    });
    const childExecutionId = String(parentToolStep!.work.childExecutionId);
    const child = await dataSource
      .getRepository(ExecutionEntity)
      .findOneByOrFail({ executionId: childExecutionId });
    expect(child).toMatchObject({
      rootExecutionId: created.executionId,
      parentExecutionId: created.executionId,
      taskType: 'delegated-agent',
      turnId: created.turnId,
      payload: {
        delegationOperationId: prepared.plan.operationId,
        joinPolicy: 'all',
        depth: 1,
      },
    });
    const childStepId = String(parentToolStep!.work.childStepId);
    await expect(agentLoopService.prepareReadyInferences(1)).resolves.toBe(1);
    const workerId = randomUUID();
    const assignment = await attemptService.claimReadyStep({
      workerId,
      stepKinds: [ExecutionStepKind.INFERENCE],
      capabilities: ['assistant-chat'],
      leaseDurationMs: 30_000,
    });
    expect(assignment).toMatchObject({
      executionId: childExecutionId,
      stepId: childStepId,
      work: {
        taskType: 'assistant-chat',
        agentName: 'subagent',
        payload: { delegationMode: true },
      },
    });
    await attemptService.startAttempt(assignment!.attemptId, workerId);
    await attemptService.receiveResult({
      executionId: assignment!.executionId,
      stepId: assignment!.stepId,
      operationId: assignment!.operationId,
      attemptId: assignment!.attemptId,
      workerId,
      result: {
        schemaVersion: 'step-result/1',
        executionId: assignment!.executionId,
        stepId: assignment!.stepId,
        operationId: assignment!.operationId,
        attemptId: assignment!.attemptId,
        stepKind: ExecutionStepKind.INFERENCE,
        status: 'succeeded',
        codeFingerprint: TEST_CODE_FINGERPRINT,
        runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
        output: {
          kind: ExecutionStepKind.INFERENCE,
          outcome: {
            kind: 'final_text',
            text: 'Independent comparison',
          },
        },
        usage: {
          promptTokens: 8,
          completionTokens: 4,
          totalTokens: 12,
        },
        inference: {
          effectiveModel: 'e2e-model',
          effectiveAdapter: null,
          effectivePromptPackages: ['e2e-prompt'],
          finishReason: 'stop',
          inferenceMs: 1,
          cacheOutcome: 'miss',
          warnings: [],
        },
        artifactRefs: [],
        error: null,
      },
    });
    await expect(attemptService.processReceivedResults(1)).resolves.toBe(1);
    await expect(
      dataSource
        .getRepository(ExecutionStepEntity)
        .findOneByOrFail({ stepId: parentToolStep!.stepId }),
    ).resolves.toMatchObject({ status: ExecutionStepStatus.BLOCKED });
    await service.completeExecution(
      childExecutionId,
      'Independent comparison',
      null,
      undefined,
      {
        socketEvent: 'executionDelegationCompleted',
        payload: { executionId: childExecutionId },
      },
    );
    await expect(agentLoopService.releaseTerminalDelegations(1)).resolves.toBe(
      1,
    );

    const runtime = new ExecutionToolRuntimeService(
      attemptService,
      new ExecutionContractValidator(),
      { globalSearch: async () => [] },
      {
        createFromExecution: async () => {
          throw new Error('unexpected_user_task_creation');
        },
        findByExecutionOperation: async () => null,
      },
      service,
    );
    await expect(runtime.executeReady(1)).resolves.toBe(1);
    await expect(attemptService.processReceivedResults(1)).resolves.toBe(1);
    await expect(
      dataSource
        .getRepository(ExecutionStepEntity)
        .findOneByOrFail({ stepId: parentToolStep!.stepId }),
    ).resolves.toMatchObject({
      status: ExecutionStepStatus.COMPLETED,
      result: {
        toolResult: {
          status: 'succeeded',
          content: 'Independent comparison',
          structuredContent: {
            childExecutionId,
            childStatus: 'completed',
            joinPolicy: 'all',
          },
        },
      },
    });
  });

  it('executes documents.search and accepts its canonical ToolResult', async () => {
    const created = await service.createForChat(
      'assistant_chat',
      'Find the harness plan',
      { ownerPrincipal: 'tool-e2e' },
      {},
    );
    const sourceAttemptId = randomUUID();
    await activateStepAttempt(created.executionId, sourceAttemptId);
    const prepared = await toolPlanService.prepare({
      schemaVersion: 'tool-invocation/1',
      toolCallId: randomUUID(),
      name: 'documents.search',
      arguments: { query: 'harness', limit: 2 },
      requester: {
        kind: 'deterministic',
        component: 'documents-backend',
      },
      executionContext: {
        executionId: created.executionId,
        turnId: created.turnId!,
        causedByEventId: created.lastEventId!,
        phase: 'agent_loop',
        dataClassification: 'workspace',
      },
    });
    const { grant } = await budgets.requestProgressGrant(created.executionId, {
      executionId: created.executionId,
      turnId: created.turnId!,
      loopId: created.executionId,
      agentName: 'assistant',
      loopKind: 'top_level',
      requestedPolicy: {
        normal: 1,
        normalInferenceSoftLimit: 1,
        repair: 0,
        closing: 0,
        maxTokensPerInference: 128,
        toolCalls: 1,
        toolCallSoftLimit: 1,
        exactToolRepeatWarning: false,
        exactToolRepeatBlockAfterWarning: false,
        exactToolRepeatTerminateAfterBlock: false,
      },
    });
    const reserved = await budgets.reserveOperationBudget(created.executionId, {
      executionId: created.executionId,
      loopId: created.executionId,
      grantId: grant.grantId,
      operationId: prepared.plan.operationId,
      operationKind: 'tool_call',
      bucket: 'tool',
      toolCallId: prepared.plan.toolCallId,
      phase: 'agent_loop',
      round: 1,
      name: 'documents.search',
    });
    const step = await toolPlanService.materialize(
      prepared.plan.toolCallId,
      reserved.reservation.reservationId,
    );
    const runtime = new ExecutionToolRuntimeService(
      attemptService,
      new ExecutionContractValidator(),
      {
        globalSearch: async () => [
          {
            id: 17,
            name: 'Harness implementation plan',
            score: 0.95,
            collection: 'docs',
          },
        ],
      },
      {
        createFromExecution: async () => {
          throw new Error('unexpected_user_task_creation');
        },
        findByExecutionOperation: async () => null,
      },
      service,
    );

    await expect(runtime.executeReady()).resolves.toBe(1);
    await expect(attemptService.processReceivedResults()).resolves.toBe(1);

    await expect(
      dataSource.getRepository(ExecutionStepEntity).findOneByOrFail({
        stepId: step.stepId,
      }),
    ).resolves.toMatchObject({
      status: ExecutionStepStatus.COMPLETED,
      result: {
        kind: 'tool',
        toolResult: {
          operationId: prepared.plan.operationId,
          toolCallId: prepared.plan.toolCallId,
          status: 'succeeded',
          structuredContent: { count: 1 },
          effects: [],
          error: null,
        },
      },
    });
    await expect(
      dataSource.getRepository(ExecutionOperationEntity).findOneByOrFail({
        operationId: prepared.plan.operationId,
      }),
    ).resolves.toMatchObject({
      status: ExecutionOperationStatus.SUCCEEDED,
      result: {
        schemaVersion: 'tool-result/1',
        operationId: prepared.plan.operationId,
        toolCallId: prepared.plan.toolCallId,
        status: 'succeeded',
      },
    });
    const persistedExecution = await dataSource
      .getRepository(ExecutionEntity)
      .findOneByOrFail({ executionId: created.executionId });
    expect(
      persistedExecution.progressLedger.operationBudget?.reservations[
        prepared.plan.operationId
      ],
    ).toMatchObject({
      reservationId: reserved.reservation.reservationId,
      status: 'consumed',
    });
    const operationEvents = await dataSource
      .getRepository(ExecutionEventEntity)
      .find({
        where: {
          rootExecutionId: created.rootExecutionId,
          operationId: prepared.plan.operationId,
        },
        order: { sequence: 'ASC' },
      });
    expect(operationEvents.map((event) => event.eventType)).toEqual([
      'operation.started',
      'operation.finished',
    ]);
    const [started, finished] = operationEvents;
    expect(started.attemptId).toEqual(expect.any(String));
    expect(started.envelope).toMatchObject({
      stepId: step.stepId,
      operationId: prepared.plan.operationId,
      toolCallId: prepared.plan.toolCallId,
      attemptId: started.attemptId,
      payload: {
        operationKind: 'tool_call',
        status: 'dispatched',
        name: 'documents.search',
        loopId: created.executionId,
        loopKind: 'top_level',
        round: 1,
        phase: 'agent_loop',
        budgetGrantId: grant.grantId,
        budgetReservationId: reserved.reservation.reservationId,
        budgetBucket: 'tool',
      },
    });
    expect(finished).toMatchObject({
      attemptId: started.attemptId,
      causedByEventId: started.eventId,
    });
    expect(finished.envelope).toMatchObject({
      stepId: step.stepId,
      operationId: prepared.plan.operationId,
      toolCallId: prepared.plan.toolCallId,
      attemptId: started.attemptId,
      payload: {
        operationKind: 'tool_call',
        status: 'succeeded',
        result: {
          schemaVersion: 'tool-result/1',
          operationId: prepared.plan.operationId,
          toolCallId: prepared.plan.toolCallId,
          status: 'succeeded',
        },
        error: null,
      },
    });
    const eventsBeforeStart = await dataSource
      .getRepository(ExecutionEventEntity)
      .find({
        where: { rootExecutionId: created.rootExecutionId },
        order: { sequence: 'ASC' },
      });
    const budgetStateBeforeStart = projectExecutionProgress(
      eventsBeforeStart
        .filter((event) => Number(event.sequence) < Number(started.sequence))
        .map((event) => event.envelope as unknown as ProgressEvent),
    );
    const governedStart = governedBudgetStart(
      persistedExecution,
      started.envelope,
    );
    expect(governedStart).not.toBeNull();
    expect(() =>
      assertOperationBudgetProjection(
        governedStart!,
        budgetStateBeforeStart.ledger.operationBudget,
        exactToolRepeatGuardSnapshot(
          budgetStateBeforeStart.ledger,
          grant.grantId,
        ),
      ),
    ).not.toThrow();
  });

  it('turns an accepted tool_requests outcome into governed tool work', async () => {
    const created = await service.createForChat(
      'assistant_chat',
      'Find the harness plan',
      { ownerPrincipal: 'agent-loop-e2e' },
      {},
    );
    await expect(agentLoopService.prepareReadyInferences()).resolves.toBe(1);
    const governedStep = await dataSource
      .getRepository(ExecutionStepEntity)
      .findOneByOrFail({ executionId: created.executionId });
    expect(governedStep.budgetReservationId).toEqual(expect.any(String));

    const workerId = randomUUID();
    const assignment = await attemptService.claimReadyStep({
      workerId,
      stepKinds: [ExecutionStepKind.INFERENCE],
      capabilities: ['assistant-chat'],
      leaseDurationMs: 30_000,
    });
    expect(assignment).not.toBeNull();
    await attemptService.startAttempt(assignment!.attemptId, workerId);
    const toolCallId = randomUUID();
    await attemptService.receiveResult({
      executionId: assignment!.executionId,
      stepId: assignment!.stepId,
      operationId: assignment!.operationId,
      attemptId: assignment!.attemptId,
      workerId,
      result: {
        schemaVersion: 'step-result/1',
        executionId: assignment!.executionId,
        stepId: assignment!.stepId,
        operationId: assignment!.operationId,
        attemptId: assignment!.attemptId,
        stepKind: ExecutionStepKind.INFERENCE,
        status: 'succeeded',
        codeFingerprint: TEST_CODE_FINGERPRINT,
        runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
        output: {
          kind: ExecutionStepKind.INFERENCE,
          outcome: {
            kind: 'tool_requests',
            calls: [
              {
                toolCallId,
                name: 'documents.search',
                arguments: { query: 'harness', limit: 2 },
              },
            ],
          },
        },
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        },
        inference: {
          effectiveModel: 'e2e-model',
          effectiveAdapter: null,
          effectivePromptPackages: ['e2e-prompt'],
          finishReason: 'tool_calls',
          inferenceMs: 1,
          cacheOutcome: 'miss',
          warnings: [],
        },
        artifactRefs: [],
        error: null,
      },
    });
    await expect(attemptService.processReceivedResults()).resolves.toBe(1);
    await expect(
      agentLoopService.materializeAcceptedToolRequests(),
    ).resolves.toBe(1);

    const plan = await dataSource
      .getRepository(ExecutionToolPlanEntity)
      .findOneByOrFail({ toolCallId });
    expect(plan.stepId).toEqual(expect.any(String));
    await expect(
      dataSource
        .getRepository(ExecutionStepEntity)
        .findOneByOrFail({ stepId: plan.stepId! }),
    ).resolves.toMatchObject({
      status: ExecutionStepStatus.READY,
      stepKind: ExecutionStepKind.TOOL,
      budgetReservationId: expect.any(String),
      work: {
        taskType: 'documents.search',
        toolPlan: { toolCallId, operationId: plan.operationId },
      },
    });
    await expect(
      agentLoopService.materializeAcceptedToolRequests(),
    ).resolves.toBe(0);
    await expect(
      dataSource
        .getRepository(ExecutionStepEntity)
        .findOneByOrFail({ stepId: assignment!.stepId }),
    ).resolves.toMatchObject({ continuationProcessedAt: expect.any(Date) });

    const runtime = new ExecutionToolRuntimeService(
      attemptService,
      new ExecutionContractValidator(),
      {
        globalSearch: async () => [
          {
            id: 23,
            name: 'Harness plan',
            score: 0.9,
            collection: 'docs',
          },
        ],
      },
      {
        createFromExecution: async () => {
          throw new Error('unexpected_user_task_creation');
        },
        findByExecutionOperation: async () => null,
      },
      service,
    );
    await expect(runtime.executeReady()).resolves.toBe(1);
    await expect(attemptService.processReceivedResults()).resolves.toBe(1);
    await expect(
      agentLoopService.materializeReadyToolContinuations(),
    ).resolves.toBe(1);

    const source = await dataSource
      .getRepository(ExecutionStepEntity)
      .findOneByOrFail({ stepId: assignment!.stepId });
    expect(source.continuationStepId).toEqual(expect.any(String));
    await expect(
      dataSource
        .getRepository(ExecutionStepEntity)
        .findOneByOrFail({ stepId: source.continuationStepId! }),
    ).resolves.toMatchObject({
      status: ExecutionStepStatus.READY,
      stepKind: ExecutionStepKind.INFERENCE,
      budgetReservationId: null,
      work: {
        taskType: 'assistant-chat',
        agentName: 'assistant',
        payload: {
          toolHistory: [
            {
              round: 1,
              calls: [{ toolCallId, name: 'documents.search' }],
              results: [
                {
                  toolCallId,
                  status: 'succeeded',
                  structuredContent: { count: 1 },
                },
              ],
            },
          ],
        },
      },
    });
    await expect(
      agentLoopService.materializeReadyToolContinuations(),
    ).resolves.toBe(0);
    await expect(agentLoopService.prepareReadyInferences()).resolves.toBe(1);
  });

  it('registers and authenticates an isolated Models identity', async () => {
    const workerId = randomUUID();
    const registration = await workerService.registerModels(
      workerId,
      'models-e2e',
      ['detect-language'],
      [ExecutionStepKind.SERVICE],
      1,
      { runtime: 'test' },
    );

    expect(registration.worker.id).toBe(workerId);
    expect(registration.credential).not.toContain(workerId);
    await expect(
      workerService.authenticate(
        workerId,
        registration.credential,
        WorkerKind.MODELS,
      ),
    ).resolves.toMatchObject({ id: workerId });
    await expect(
      workerService.authenticate(
        workerId,
        'wrong-credential',
        WorkerKind.MODELS,
      ),
    ).rejects.toThrow('invalid_worker_credential');
    const rotation = await workerService.registerModels(
      workerId,
      'models-e2e',
      [],
      [ExecutionStepKind.SERVICE],
      1,
      {},
    );
    expect(rotation.credential).not.toBe(registration.credential);
    await expect(
      workerService.authenticate(
        workerId,
        registration.credential,
        WorkerKind.MODELS,
      ),
    ).rejects.toThrow('invalid_worker_credential');
    await expect(
      workerService.authenticate(
        workerId,
        rotation.credential,
        WorkerKind.MODELS,
      ),
    ).resolves.toMatchObject({ id: workerId });
  });

  it('enrolls and revokes a browser identity without Models access', async () => {
    const installationId = randomUUID();
    const registration = await workerService.enrollBrowser(
      installationId,
      'ia-browser-e2e',
      'browser-owner',
      { runtime: 'test' },
    );

    await expect(
      workerService.authenticate(
        installationId,
        registration.credential,
        WorkerKind.BROWSER,
      ),
    ).resolves.toMatchObject({
      id: installationId,
      workerKind: WorkerKind.BROWSER,
      ownerPrincipal: 'browser-owner',
      capabilities: ['browser.read'],
    });
    await expect(
      workerService.authenticate(
        installationId,
        registration.credential,
        WorkerKind.MODELS,
      ),
    ).rejects.toThrow('invalid_worker_credential');

    await service.create(
      'browser-read-current-page',
      ExecutionPriority.NORMAL,
      {},
      {
        ownerPrincipal: 'different-owner',
        initialStep: {
          stepKind: ExecutionStepKind.VERIFICATION,
          work: { taskType: 'browser-read-current-page', payload: {} },
          requiredCapabilities: ['browser.read'],
        },
      },
    );
    const owned = await service.create(
      'browser-read-current-page',
      ExecutionPriority.NORMAL,
      {},
      {
        ownerPrincipal: 'browser-owner',
        initialStep: {
          stepKind: ExecutionStepKind.VERIFICATION,
          work: { taskType: 'browser-read-current-page', payload: {} },
          requiredCapabilities: ['browser.read'],
        },
      },
    );
    const assignment = await attemptService.claimReadyStep({
      workerId: installationId,
      ownerPrincipal: 'browser-owner',
      stepKinds: [ExecutionStepKind.VERIFICATION],
      capabilities: ['browser.read'],
      leaseDurationMs: 60_000,
      enforceRegisteredWorkerCapacity: true,
    });
    expect(assignment).toMatchObject({ executionId: owned.executionId });
    await expect(
      attemptService.startAttempt(assignment!.attemptId, installationId),
    ).resolves.toMatchObject({ status: ExecutionStepAttemptStatus.RUNNING });
    await expect(
      attemptService.startAttempt(assignment!.attemptId, installationId),
    ).resolves.toMatchObject({ status: ExecutionStepAttemptStatus.RUNNING });
    await expect(
      service.readProgress(owned.rootExecutionId, {
        ownerPrincipal: 'browser-owner',
      }),
    ).resolves.toMatchObject({
      runtime: {
        status: ExecutionStatus.RUNNING,
        activeSteps: [
          {
            taskType: 'browser-read-current-page',
            attemptStatus: ExecutionStepAttemptStatus.RUNNING,
            worker: {
              workerId: installationId,
              name: 'ia-browser-e2e',
              kind: WorkerKind.BROWSER,
            },
          },
        ],
      },
    });

    const pageArtifactId = randomUUID();
    const pageBody = Buffer.from(
      JSON.stringify({
        url: 'https://example.test',
        text: 'Example page',
        truncated: false,
      }),
    );
    const pageArtifact = {
      artifactId: pageArtifactId,
      kind: 'browser-page-snapshot',
      contentHash: contentHash(pageBody),
      size: pageBody.length,
      mediaType: 'application/json' as const,
      encoding: 'identity' as const,
      dataClassification: 'workspace',
      redaction: { applied: false },
      retentionClass: 'execution',
      inputSourceIds: [],
      bodyBase64: pageBody.toString('base64'),
    };
    await expect(
      attemptService.uploadOutputArtifact(
        assignment!.attemptId,
        installationId,
        pageArtifact,
      ),
    ).resolves.toMatchObject({ code: 'received' });
    await expect(
      attemptService.uploadOutputArtifact(
        assignment!.attemptId,
        installationId,
        pageArtifact,
      ),
    ).resolves.toMatchObject({ code: 'duplicate' });

    const result = {
      schemaVersion: 'step-result/1',
      executionId: assignment!.executionId,
      stepId: assignment!.stepId,
      operationId: assignment!.operationId,
      attemptId: assignment!.attemptId,
      stepKind: ExecutionStepKind.VERIFICATION,
      status: 'succeeded',
      runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
      artifactRefs: [{ role: 'browser_page', artifactId: pageArtifactId }],
      error: null,
      output: {
        kind: ExecutionStepKind.VERIFICATION,
        page: {
          url: 'https://example.test',
          truncated: false,
          contentArtifactId: pageArtifactId,
          contentHash: contentHash(pageBody),
          size: pageBody.length,
        },
      },
    };
    await expect(
      attemptService.receiveResult({
        executionId: assignment!.executionId,
        stepId: assignment!.stepId,
        operationId: assignment!.operationId,
        attemptId: assignment!.attemptId,
        workerId: installationId,
        result,
      }),
    ).resolves.toMatchObject({ code: 'received' });
    await expect(
      attemptService.receiveResult({
        executionId: assignment!.executionId,
        stepId: assignment!.stepId,
        operationId: assignment!.operationId,
        attemptId: assignment!.attemptId,
        workerId: installationId,
        result,
      }),
    ).resolves.toMatchObject({ code: 'duplicate' });
    await expect(attemptService.processReceivedResults()).resolves.toBe(1);

    await workerService.revokeBrowser(installationId, 'browser-owner');
    await expect(
      workerService.authenticate(
        installationId,
        registration.credential,
        WorkerKind.BROWSER,
      ),
    ).rejects.toThrow('invalid_worker_credential');
    await expect(workerService.findById(installationId)).resolves.toMatchObject(
      {
        status: 'revoked',
        revokedAt: expect.any(Date),
      },
    );
  });

  it('serializes concurrent claims at the registered worker limit', async () => {
    const workerId = randomUUID();
    await workerService.registerModels(
      workerId,
      'models-concurrency-e2e',
      ['detect-language'],
      [ExecutionStepKind.SERVICE],
      1,
      { runtime: 'test' },
    );
    await Promise.all(
      ['worker-limit-first', 'worker-limit-second'].map((name) =>
        service.create(
          name,
          ExecutionPriority.NORMAL,
          {},
          {
            initialStep: {
              stepKind: ExecutionStepKind.SERVICE,
              work: { taskType: 'detect-language' },
              requiredCapabilities: ['detect-language'],
            },
          },
        ),
      ),
    );

    const claims = await Promise.all([
      attemptService.claimReadyStep({
        workerId,
        stepKinds: [ExecutionStepKind.SERVICE],
        capabilities: ['detect-language'],
        leaseDurationMs: 30_000,
        enforceRegisteredWorkerCapacity: true,
      }),
      attemptService.claimReadyStep({
        workerId,
        stepKinds: [ExecutionStepKind.SERVICE],
        capabilities: ['detect-language'],
        leaseDurationMs: 30_000,
        enforceRegisteredWorkerCapacity: true,
      }),
    ]);

    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.filter((claim) => claim === null)).toHaveLength(1);
    const registration = (await workerService.registrations()).find(
      (worker) => worker.workerId === workerId,
    );
    expect(registration).toEqual(
      expect.objectContaining({
        concurrency: { maximum: 1, available: 0 },
        activeAssignments: [claims.find(Boolean)?.attemptId],
        loadSummary: { state: 'busy', active: 1 },
      }),
    );
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
      runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
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
      dataSource.getRepository(ExecutionOperationEntity).findOneByOrFail({
        operationId: attempt.operationId,
      }),
    ).resolves.toMatchObject({
      operationId: attempt.operationId,
      status: ExecutionOperationStatus.SUCCEEDED,
      currentAttemptId: null,
      result: { kind: 'service', value: { language: 'en' } },
    });
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

  it('runs summarize fan-out and fan-in on the canonical step graph', async () => {
    const firstMapId = randomUUID();
    const secondMapId = randomUUID();
    const created = await service.create(
      'summarize',
      ExecutionPriority.NORMAL,
      { targetLanguage: 'en' },
      {
        steps: [
          {
            stepId: firstMapId,
            stepKind: ExecutionStepKind.INFERENCE,
            work: {
              taskType: 'summarize-map',
              payload: { content: 'first', chunkIndex: 0 },
            },
            requiredCapabilities: ['summarize-map'],
          },
          {
            stepId: secondMapId,
            stepKind: ExecutionStepKind.INFERENCE,
            work: {
              taskType: 'summarize-map',
              payload: { content: 'second', chunkIndex: 1 },
            },
            requiredCapabilities: ['summarize-map'],
          },
          {
            stepKind: ExecutionStepKind.INFERENCE,
            dependsOnStepIds: [firstMapId, secondMapId],
            work: {
              taskType: 'summarize-reduce',
              payload: { targetLanguage: 'en' },
              coordination: {
                kind: 'map-reduce-reduce/1',
                mapStepIds: [firstMapId, secondMapId],
                resultKey: 'response',
              },
            },
            requiredCapabilities: ['summarize-reduce'],
          },
        ],
      },
    );
    const workerId = randomUUID();
    const inferenceMetadata = {
      codeFingerprint: TEST_CODE_FINGERPRINT,
      runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
      usage: {
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
      },
      inference: {
        effectiveModel: 'e2e-model',
        effectiveAdapter: null,
        effectivePromptPackages: ['e2e-prompt'],
        finishReason: 'completed',
        inferenceMs: 1,
        cacheOutcome: 'unknown',
        warnings: [],
      },
    };
    const assignments = await Promise.all([
      attemptService.claimReadyStep({
        workerId,
        stepKinds: [ExecutionStepKind.INFERENCE],
        capabilities: ['summarize-map'],
        leaseDurationMs: 30_000,
      }),
      attemptService.claimReadyStep({
        workerId,
        stepKinds: [ExecutionStepKind.INFERENCE],
        capabilities: ['summarize-map'],
        leaseDurationMs: 30_000,
      }),
    ]);
    expect(assignments.every(Boolean)).toBe(true);

    for (const assignment of assignments.reverse()) {
      await attemptService.startAttempt(assignment!.attemptId, workerId);
      const chunkIndex = Number(
        (assignment!.work.payload as Record<string, unknown>).chunkIndex,
      );
      await attemptService.receiveResult({
        executionId: assignment!.executionId,
        stepId: assignment!.stepId,
        operationId: assignment!.operationId,
        attemptId: assignment!.attemptId,
        workerId,
        result: {
          schemaVersion: 'step-result/1',
          executionId: assignment!.executionId,
          stepId: assignment!.stepId,
          operationId: assignment!.operationId,
          attemptId: assignment!.attemptId,
          stepKind: ExecutionStepKind.INFERENCE,
          status: 'succeeded',
          output: {
            kind: ExecutionStepKind.INFERENCE,
            outcome: {
              kind: 'structured_result',
              schemaId: 'summarize-map-output/1',
              value: { response: chunkIndex === 0 ? 'first' : 'second' },
            },
          },
          ...inferenceMetadata,
          artifactRefs: [],
          error: null,
        },
      });
    }
    await expect(attemptService.processReceivedResults()).resolves.toBe(2);

    const reduceAssignment = await attemptService.claimReadyStep({
      workerId,
      stepKinds: [ExecutionStepKind.INFERENCE],
      capabilities: ['summarize-reduce'],
      leaseDurationMs: 30_000,
    });
    expect(reduceAssignment?.work).toMatchObject({
      taskType: 'summarize-reduce',
      payload: { partials: ['first', 'second'] },
    });
    await attemptService.startAttempt(reduceAssignment!.attemptId, workerId);
    await attemptService.receiveResult({
      executionId: reduceAssignment!.executionId,
      stepId: reduceAssignment!.stepId,
      operationId: reduceAssignment!.operationId,
      attemptId: reduceAssignment!.attemptId,
      workerId,
      result: {
        schemaVersion: 'step-result/1',
        executionId: reduceAssignment!.executionId,
        stepId: reduceAssignment!.stepId,
        operationId: reduceAssignment!.operationId,
        attemptId: reduceAssignment!.attemptId,
        stepKind: ExecutionStepKind.INFERENCE,
        status: 'succeeded',
        output: {
          kind: ExecutionStepKind.INFERENCE,
          outcome: {
            kind: 'structured_result',
            schemaId: 'summarize-reduce-output/1',
            value: { response: 'merged' },
          },
        },
        ...inferenceMetadata,
        artifactRefs: [],
        error: null,
      },
    });
    await expect(attemptService.processReceivedResults()).resolves.toBe(1);
    await expect(
      dataSource.getRepository(ExecutionEntity).findOneByOrFail({
        executionId: created.executionId,
      }),
    ).resolves.toMatchObject({
      status: ExecutionStatus.RUNNING,
      phase: 'backend_finalization',
      result: { response: 'merged' },
    });
  });

  it('keeps assistant and agent chat as distinct execution types', async () => {
    const scope = { ownerPrincipal: 'e2e-user' };
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
    const scope = { ownerPrincipal: 'e2e-user' };
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
        ownerPrincipal: 'other-user',
      }),
    ).rejects.toThrow('Execution not found');

    await expect(
      service.exportBundle(context.rootExecutionId, scope, false),
    ).rejects.toThrow('Explicit consent');
    const bundle = await service.exportBundle(
      context.rootExecutionId,
      scope,
      true,
    );
    expect(JSON.stringify(bundle)).not.toContain('known-secret');
    expect(bundle.embeddedArtifacts).toBeDefined();
    expect(bundle.bundleCompleteness).toEqual({
      status: 'reproducible',
      reproducible: true,
      missing: [],
    });
    expect(bundle.policySummary).toEqual({
      decision: 'allow',
      purpose: 'evaluation',
      consent: {
        status: 'granted',
        basis: 'explicit_export_request',
      },
      allowedDestinations: ['ai-train'],
      retentionClass: 'evaluation',
      accessScope: scope,
    });
    const bundleEvents = bundle.events as Record<string, any>[];
    const bundleArtifacts = bundle.artifacts as Record<string, any>[];
    const userSource = bundleEvents.find(
      (event: any) => event.eventType === 'source.observed',
    );
    const userArtifact = bundleArtifacts.find(
      (artifact: any) => artifact.kind === 'user_message',
    );
    expect(userArtifact.inputSourceIds).toEqual([userSource.payload.sourceId]);

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
    const scope = { ownerPrincipal: 'e2e-user' };
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
    const { grant } = await budgets.requestProgressGrant(context.executionId, {
      executionId: context.executionId,
      turnId: context.turnId,
      loopId: context.executionId,
      agentName: 'assistant',
      loopKind: 'top_level',
      requestedPolicy,
    });
    const reserve = (operationId: string) =>
      budgets.reserveOperationBudget(context.executionId, {
        executionId: context.executionId,
        loopId: context.executionId,
        grantId: grant.grantId,
        operationId,
        operationKind: 'inference',
        bucket: 'normal',
        phase: 'direct_response',
        round: 1,
        name: 'direct_response',
      });

    const decisions = await Promise.all([
      reserve(randomUUID()),
      reserve(randomUUID()),
    ]);
    expect(decisions.filter((decision) => decision.granted)).toHaveLength(1);
    expect(decisions.filter((decision) => !decision.granted)).toHaveLength(1);

    const reserveTool = (operationId: string, toolCallId: string) =>
      budgets.reserveOperationBudget(context.executionId, {
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
    const repeated = await budgets.requestProgressGrant(context.executionId, {
      executionId: context.executionId,
      turnId: context.turnId,
      loopId: context.executionId,
      agentName: 'assistant',
      loopKind: 'top_level',
      requestedPolicy,
    });
    expect(repeated.grant.grantId).toBe(grant.grantId);
    await expect(reserve(randomUUID())).resolves.toMatchObject({
      granted: false,
      reservation: { reason: 'budget_hard_limit_reached' },
    });
    await expect(
      reserveTool(randomUUID(), randomUUID()),
    ).resolves.toMatchObject({
      granted: false,
      reservation: { reason: 'tool_budget_hard_limit_reached' },
    });
  });

  it('records one soft-limit signal when concurrent tool reservations cross it', async () => {
    const scope = { ownerPrincipal: 'e2e-user' };
    const context = await service.createForChat(
      'assistant_chat',
      'cross the tool soft limit',
      scope,
      {},
    );
    const attemptId = randomUUID();
    await activateStepAttempt(context.executionId, attemptId);
    const { grant } = await budgets.requestProgressGrant(context.executionId, {
      executionId: context.executionId,
      turnId: context.turnId,
      loopId: context.executionId,
      agentName: 'assistant',
      loopKind: 'top_level',
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
      budgets.reserveOperationBudget(context.executionId, {
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
    const scope = { ownerPrincipal: 'e2e-user' };
    const context = await service.createForChat(
      'assistant_chat',
      'cross the normal inference soft limit',
      scope,
      {},
    );
    const attemptId = randomUUID();
    await activateStepAttempt(context.executionId, attemptId);
    const { grant } = await budgets.requestProgressGrant(context.executionId, {
      executionId: context.executionId,
      turnId: context.turnId,
      loopId: context.executionId,
      agentName: 'assistant',
      loopKind: 'top_level',
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
      budgets.reserveOperationBudget(context.executionId, {
        executionId: context.executionId,
        loopId: context.executionId,
        grantId: grant.grantId,
        operationId,
        operationKind: 'inference',
        bucket: 'normal',
        phase: 'agent_loop',
        round: 1,
        name: 'chat_with_tools',
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
    const scope = { ownerPrincipal: 'e2e-user' };
    const context = await service.createForChat(
      'assistant_chat',
      'repeat one exact tool call',
      scope,
      {},
    );
    const attemptId = randomUUID();
    await activateStepAttempt(context.executionId, attemptId);
    const { grant } = await budgets.requestProgressGrant(context.executionId, {
      executionId: context.executionId,
      turnId: context.turnId,
      loopId: context.executionId,
      agentName: 'assistant',
      loopKind: 'top_level',
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
      budgets.reserveOperationBudget(context.executionId, {
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
    const inference = await budgets.reserveOperationBudget(
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
    const scope = { ownerPrincipal: 'e2e-user' };
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
    const { grant } = await budgets.requestProgressGrant(context.executionId, {
      executionId: context.executionId,
      turnId: context.turnId,
      loopId: context.executionId,
      agentName: 'assistant',
      loopKind: 'top_level',
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
    const normalReservation = await budgets.reserveOperationBudget(
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
    const toolReservation = await budgets.reserveOperationBudget(
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
    const closingReservation = await budgets.reserveOperationBudget(
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
    await service.completeExecution(
      context.executionId,
      reply,
      null,
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

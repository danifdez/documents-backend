import { randomUUID } from 'crypto';
import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { CreateExecutions1757668140001 } from '../migrations/1757668140001-CreateExecutions';
import { AddExecutionProgress1757668140350 } from '../migrations/1757668140350-AddExecutionProgress';
import { ExecutionArtifactEntity } from '../src/execution/execution-artifact.entity';
import { ExecutionContractValidator } from '../src/execution/execution-contract-validator';
import { ExecutionEventEntity } from '../src/execution/execution-event.entity';
import { ExecutionEntity } from '../src/execution/execution.entity';
import {
  contentHash,
  ExecutionService,
} from '../src/execution/execution.service';
import { WorkerEntity } from '../src/worker/worker.entity';

loadEnv({ path: '.env' });

describe('execution PostgreSQL integration', () => {
  const schema = `execution_test_${randomUUID().replaceAll('-', '_')}`;
  let dataSource: DataSource;
  let service: ExecutionService;

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
    await runner.release();

    service = new ExecutionService(
      dataSource,
      dataSource.getRepository(ExecutionEntity),
      dataSource.getRepository(ExecutionEventEntity),
      dataSource.getRepository(ExecutionArtifactEntity),
      { get: (_key: string, fallback?: unknown) => fallback } as any,
      new ExecutionContractValidator(),
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

  it('recovers stale attempts and fails executions that exhausted retries', async () => {
    const scope = { ownerPrincipal: 'e2e-user', workspaceId: 'e2e-workspace' };
    const workerId = randomUUID();
    const recoverable = await service.createForChat(
      'assistant_chat',
      'recover me',
      scope,
      {},
    );
    const exhausted = await service.createForChat(
      'assistant_chat',
      'fail me',
      scope,
      {},
    );
    const recoverableAttempt = randomUUID();
    const exhaustedAttempt = randomUUID();

    await dataSource.query(
      `INSERT INTO "${schema}"."workers"
       ("id", "name", "last_heartbeat") VALUES ($1, 'stale-worker', $2)`,
      [workerId, new Date('2026-08-19T09:00:00Z')],
    );
    await dataSource.query(
      `UPDATE "${schema}"."executions"
       SET "status" = 'running', "phase" = 'worker_execution',
           "claimed_by" = $1, "attempt_id" = $2, "max_attempts" = $3
       WHERE "execution_id" = $4`,
      [workerId, recoverableAttempt, 3, recoverable.executionId],
    );
    await dataSource.query(
      `UPDATE "${schema}"."executions"
       SET "status" = 'running', "phase" = 'worker_execution',
           "claimed_by" = $1, "attempt_id" = $2, "max_attempts" = $3
       WHERE "execution_id" = $4`,
      [workerId, exhaustedAttempt, 1, exhausted.executionId],
    );

    await expect(
      service.requeueStaleExecutions(new Date('2026-08-19T10:00:00Z')),
    ).resolves.toBe(2);

    const recovered = await service.findOne(recoverable.executionId);
    const failed = await service.findOne(exhausted.executionId);
    expect(recovered).toMatchObject({
      status: 'queued',
      phase: null,
      claimedBy: null,
      attemptId: null,
      retryCount: 1,
    });
    expect(failed).toMatchObject({
      status: 'failed',
      phase: null,
      claimedBy: null,
      attemptId: null,
      retryCount: 1,
      completionReason: 'attempts_exhausted',
    });
    expect(failed?.error).toEqual({
      code: 'EXECUTION_FAILED',
      message: 'Execution attempts exhausted',
    });
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
    await dataSource.query(
      `UPDATE "${schema}"."executions"
       SET "status" = 'running', "phase" = 'worker_execution',
           "attempt_id" = $1
       WHERE "execution_id" = $2`,
      [attemptId, context.executionId],
    );

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
    await dataSource.query(
      `UPDATE "${schema}"."executions" SET "attempt_id" = $1
       WHERE "execution_id" = $2`,
      [nextAttemptId, context.executionId],
    );
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
    await dataSource.query(
      `UPDATE "${schema}"."executions"
       SET "status" = 'running', "phase" = 'worker_execution',
           "attempt_id" = $1
       WHERE "execution_id" = $2`,
      [attemptId, context.executionId],
    );
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
    await dataSource.query(
      `UPDATE "${schema}"."executions"
       SET "status" = 'running', "phase" = 'worker_execution',
           "attempt_id" = $1
       WHERE "execution_id" = $2`,
      [attemptId, context.executionId],
    );
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
    await dataSource.query(
      `UPDATE "${schema}"."executions"
       SET "status" = 'running', "phase" = 'worker_execution',
           "attempt_id" = $1
       WHERE "execution_id" = $2`,
      [attemptId, context.executionId],
    );
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
    await dataSource.query(
      `UPDATE "${schema}"."executions"
       SET "status" = 'running', "phase" = 'worker_execution',
           "attempt_id" = $1
       WHERE "execution_id" = $2`,
      [attemptId, context.executionId],
    );
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
    await dataSource.query(
      `UPDATE "${schema}"."executions" SET "attempt_id" = $1
       WHERE "execution_id" = $2`,
      [staleAttemptId, context.executionId],
    );
    await expect(
      service.completeExecution(
        context.executionId,
        reply,
        null,
        undefined,
        completion,
      ),
    ).rejects.toThrow('Invalid deterministic partial result');
    await dataSource.query(
      `UPDATE "${schema}"."executions" SET "attempt_id" = $1
       WHERE "execution_id" = $2`,
      [attemptId, context.executionId],
    );

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

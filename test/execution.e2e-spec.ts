import { randomUUID } from 'crypto';
import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { CreateExecutions1757668140001 } from '../migrations/1757668140001-CreateExecutions';
import { AddExecutionProgress1757668140350 } from '../migrations/1757668140350-AddExecutionProgress';
import { ExecutionArtifactEntity } from '../src/execution/execution-artifact.entity';
import { ExecutionContractValidator } from '../src/execution/execution-contract-validator';
import { ExecutionEventEntity } from '../src/execution/execution-event.entity';
import { ExecutionEntity } from '../src/execution/execution.entity';
import { ExecutionService } from '../src/execution/execution.service';
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
      repair: 0,
      closing: 0,
      maxTokensPerInference: 512,
      toolCalls: 1,
      toolCallSoftLimit: 0,
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
        repair: 0,
        closing: 1,
        maxTokensPerInference: 512,
        toolCalls: 6,
        toolCallSoftLimit: 4,
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
});

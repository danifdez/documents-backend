import { randomUUID } from 'crypto';
import { ExecutionEventEntity } from '../../src/execution/execution-event.entity';
import type { ExecutionFixture } from './fixture';

export function registerBudgetsCases(getContext: ExecutionFixture): void {
  it('serializes the last operation budget slots and fences stale attempts', async () => {
    const { budgets, activateStepAttempt, createChat } = getContext();

    const scope = { ownerPrincipal: 'e2e-user' };
    const context = await createChat('assistant_chat', 'budget me', scope, {});
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
    const { dataSource, service, budgets, activateStepAttempt, createChat } =
      getContext();

    const scope = { ownerPrincipal: 'e2e-user' };
    const context = await createChat(
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
    const { service, budgets, activateStepAttempt, createChat } = getContext();

    const scope = { ownerPrincipal: 'e2e-user' };
    const context = await createChat(
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
}

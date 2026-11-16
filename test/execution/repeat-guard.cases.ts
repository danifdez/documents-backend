import { randomUUID } from 'crypto';
import { ExecutionEventEntity } from '../../src/execution/execution-event.entity';
import { ExecutionEntity } from '../../src/execution/execution.entity';
import type { ExecutionFixture } from './fixture';

export function registerRepeatGuardCases(getContext: ExecutionFixture): void {
  it('persists one exact-repeat signal and consumes its warning transactionally', async () => {
    const { dataSource, service, budgets, activateStepAttempt, createChat } =
      getContext();

    const scope = { ownerPrincipal: 'e2e-user' };
    const context = await createChat(
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
}

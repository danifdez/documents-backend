import { randomUUID } from 'crypto';
import { ExecutionEventEntity } from '../../src/execution/execution-event.entity';
import { ExecutionEntity } from '../../src/execution/execution.entity';
import { contentHash } from '../../src/execution/execution.service';
import type { ExecutionFixture } from './fixture';

export function registerPartialResultsCases(
  getContext: ExecutionFixture,
): void {
  it('validates, fences, finalizes, and replays a deterministic partial', async () => {
    const { dataSource, service, budgets, activateStepAttempt, createChat } =
      getContext();

    const scope = { ownerPrincipal: 'e2e-user' };
    const context = await createChat(
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
      reason: 'partial_budget_exhausted',
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
      completionReason: 'partial_budget_exhausted',
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
      completionReason: 'partial_budget_exhausted',
      completionSource: 'runtime_template',
      partialResult: completion.partialResult,
      result: { reply },
      error: null,
    });
  });
}

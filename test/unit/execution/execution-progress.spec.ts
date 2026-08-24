import { projectExecutionProgress } from '../../../src/execution/execution-progress';

describe('execution progress projection', () => {
  it('projects authoritative grants, reservations, consumption, and denials', () => {
    const grant = {
      version: '1' as const,
      grantId: 'grant-1',
      executionId: 'execution-1',
      turnId: 'turn-1',
      loopId: 'loop-1',
      profileId: 'documents_chat_v1' as const,
      policyVersion: '1' as const,
      requestedPolicy: {
        normal: 2,
        normalInferenceSoftLimit: 1,
        repair: 1,
        closing: 1,
        maxTokensPerInference: 1000,
        toolCalls: 2,
        toolCallSoftLimit: 1,
      },
      effectivePolicy: {
        normal: 1,
        normalInferenceSoftLimit: 0,
        repair: 1,
        closing: 1,
        maxTokensPerInference: 512,
        toolCalls: 1,
        toolCallSoftLimit: 0,
      },
      grantedAt: '2026-08-20T10:00:00Z',
    };
    const reservation = {
      version: '1' as const,
      reservationId: 'reservation-1',
      grantId: 'grant-1',
      operationId: 'operation-1',
      operationKind: 'inference' as const,
      bucket: 'normal' as const,
      phase: 'agent_loop',
      round: 1,
      name: 'chat_with_tools',
      status: 'reserved' as const,
      decidedAt: '2026-08-20T10:00:01Z',
    };

    const progress = projectExecutionProgress([
      {
        sequence: 1,
        eventType: 'progress.reported',
        payload: { message: 'granted', kind: 'budget_grant', grant },
      },
      {
        sequence: 2,
        eventType: 'progress.reported',
        payload: {
          message: 'reserved',
          kind: 'budget_reservation',
          reservation,
        },
      },
      {
        sequence: 3,
        eventType: 'progress.reported',
        payload: {
          message: 'duplicate delivery',
          kind: 'budget_reservation',
          reservation,
        },
      },
      {
        sequence: 4,
        eventType: 'operation.started',
        operationId: 'operation-1',
        attemptId: 'operation-attempt-1',
        payload: {
          operationKind: 'inference',
          name: 'chat_with_tools',
          loopId: 'loop-1',
          agentName: 'assistant',
          loopKind: 'top_level',
          round: 1,
          maxRounds: 1,
          phase: 'agent_loop',
          budgetGrantId: 'grant-1',
          budgetReservationId: 'reservation-1',
          budgetBucket: 'normal',
        },
      },
      {
        sequence: 5,
        eventType: 'progress.reported',
        payload: {
          message: 'denied',
          kind: 'budget_reservation',
          reservation: {
            ...reservation,
            reservationId: 'reservation-2',
            operationId: 'operation-2',
            status: 'denied',
            reason: 'budget_hard_limit_reached',
          },
        },
      },
      {
        sequence: 6,
        eventType: 'progress.reported',
        payload: {
          message: 'tool reserved',
          kind: 'budget_reservation',
          reservation: {
            ...reservation,
            reservationId: 'reservation-tool-1',
            operationId: 'operation-tool-1',
            operationKind: 'tool_call',
            bucket: 'tool',
            toolCallId: 'tool-call-1',
            name: 'folder_read',
          },
        },
      },
      {
        sequence: 7,
        eventType: 'operation.started',
        operationId: 'operation-tool-1',
        attemptId: 'operation-attempt-tool-1',
        payload: {
          operationKind: 'tool_call',
          name: 'folder_read',
        },
      },
    ]);

    expect(progress.ledger.operationBudget?.grants['grant-1'].usage).toEqual({
      normal: {
        granted: 1,
        reserved: 0,
        consumed: 1,
        available: 0,
        softLimit: 0,
        softLimitReached: false,
        softLimitWarningPending: false,
      },
      repair: { granted: 1, reserved: 0, consumed: 0, available: 1 },
      closing: { granted: 1, reserved: 0, consumed: 0, available: 1 },
      tool: {
        granted: 1,
        reserved: 0,
        consumed: 1,
        available: 0,
        softLimit: 0,
        softLimitReached: false,
      },
    });
    expect(
      progress.ledger.operationBudget?.reservations['operation-1'].status,
    ).toBe('consumed');
    expect(
      progress.ledger.operationBudget?.reservations['operation-2'].status,
    ).toBe('denied');
  });

  it('materializes policies, operation state, phases, and known token usage', () => {
    const progress = projectExecutionProgress([
      {
        sequence: 1,
        eventType: 'progress.reported',
        payload: {
          message: 'Effective progress policy recorded',
          kind: 'policy_snapshot',
          policy: {
            version: '1',
            source: 'models.task_config',
            loopId: 'loop-1',
            agentName: 'assistant',
            loopKind: 'top_level',
            maxRounds: 3,
            maxOutputRepairs: 1,
            forcedFinalizationAvailable: true,
            maxTokensPerInference: 1000,
          },
        },
      },
      {
        sequence: 2,
        eventType: 'operation.started',
        operationId: 'inference-1',
        attemptId: 'attempt-1',
        payload: {
          operationKind: 'inference',
          name: 'output_repair',
          loopId: 'loop-1',
          agentName: 'assistant',
          loopKind: 'top_level',
          round: 1,
          maxRounds: 3,
          phase: 'output_repair',
        },
      },
      {
        sequence: 3,
        eventType: 'operation.finished',
        operationId: 'inference-1',
        attemptId: 'attempt-1',
        payload: {
          operationKind: 'inference',
          status: 'succeeded',
          metrics: { promptTokens: 12, generatedTokens: 4 },
        },
      },
      {
        sequence: 4,
        eventType: 'operation.started',
        operationId: 'tool-1',
        attemptId: 'attempt-2',
        payload: {
          operationKind: 'tool_call',
          name: 'folder_read',
          loopId: 'loop-1',
          agentName: 'assistant',
          loopKind: 'top_level',
          round: 1,
          maxRounds: 3,
          phase: 'agent_loop',
        },
      },
    ]);

    expect(progress.policy?.loops['loop-1']).toMatchObject({
      agentName: 'assistant',
      maxRounds: 3,
    });
    expect(progress.ledger).toMatchObject({
      lastSequence: 4,
      operations: {
        inference: { started: 1, finished: 1, unfinished: 0, failed: 0 },
        tool_call: { started: 1, finished: 0, unfinished: 1, failed: 0 },
      },
      inferencePhases: {
        output_repair: {
          started: 1,
          finished: 1,
          unfinished: 0,
          failed: 0,
        },
      },
      loops: {
        'loop-1': {
          agentName: 'assistant',
          loopKind: 'top_level',
          maxRounds: 3,
          operations: {
            inference: { started: 1, finished: 1, unfinished: 0, failed: 0 },
            tool_call: { started: 1, finished: 0, unfinished: 1, failed: 0 },
          },
        },
      },
      promptTokens: { known: true, total: 12, unknownOperations: 0 },
      generatedTokens: { known: true, total: 4, unknownOperations: 0 },
      completeness: 'partial',
    });
  });

  it('preserves unknown token metrics instead of treating them as zero', () => {
    const progress = projectExecutionProgress([
      {
        sequence: 1,
        eventType: 'operation.started',
        operationId: 'inference-1',
        attemptId: 'attempt-1',
        payload: { operationKind: 'inference', name: 'chat' },
      },
      {
        sequence: 2,
        eventType: 'operation.finished',
        operationId: 'inference-1',
        attemptId: 'attempt-1',
        payload: {
          operationKind: 'inference',
          status: 'failed',
          metrics: { promptTokens: 'unknown', generatedTokens: 'unknown' },
        },
      },
    ]);

    expect(progress.ledger.promptTokens).toEqual({
      known: false,
      total: 0,
      unknownOperations: 1,
    });
    expect(progress.ledger.generatedTokens).toEqual({
      known: false,
      total: 0,
      unknownOperations: 1,
    });
    expect(progress.ledger.operations.inference.failed).toBe(1);
    expect(progress.ledger.completeness).toBe('complete');
  });
});

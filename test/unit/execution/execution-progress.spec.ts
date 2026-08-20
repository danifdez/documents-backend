import { projectExecutionProgress } from '../../../src/execution/execution-progress';

describe('execution progress projection', () => {
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

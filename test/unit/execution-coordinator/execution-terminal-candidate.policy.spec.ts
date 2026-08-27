import { ExecutionOperationStatus } from '../../../src/execution/execution-operation-status.enum';
import { ExecutionStatus } from '../../../src/execution/execution-status.enum';
import { ExecutionStepKind } from '../../../src/execution/execution-step-kind.enum';
import { ExecutionStepStatus } from '../../../src/execution/execution-step-status.enum';
import { selectTerminalCandidate } from '../../../src/execution-coordinator/execution-terminal-candidate.policy';

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    status: ExecutionStatus.RUNNING,
    phase: 'coordination_pending',
    cancellationRequested: false,
    result: { reply: 'Done' },
    steps: [
      {
        stepId: 'step-1',
        stepKind: ExecutionStepKind.INFERENCE,
        status: ExecutionStepStatus.COMPLETED,
        result: { outcome: { kind: 'final_text', text: 'Done' } },
        continuationProcessed: false,
        continuationStepId: null,
        terminalCandidatePrepared: false,
      },
    ],
    operationStatuses: [ExecutionOperationStatus.SUCCEEDED],
    pendingConfirmations: 0,
    unmaterializedToolPlans: 0,
    activeChildren: 0,
    ...overrides,
  };
}

describe('terminal candidate policy', () => {
  it('promotes a complete result only after every terminal gate is clear', () => {
    expect(selectTerminalCandidate(snapshot() as any)).toEqual({
      kind: 'ready',
      completionKind: 'full',
      completionReason: 'goal_satisfied',
      evidenceStepIds: ['step-1'],
    });
  });

  it('keeps a tool outcome non-terminal until its continuation exists', () => {
    const value = snapshot({
      steps: [
        {
          ...snapshot().steps[0],
          result: { outcome: { kind: 'tool_requests', calls: [{}] } },
          continuationProcessed: true,
        },
      ],
    });

    expect(selectTerminalCandidate(value as any)).toEqual({
      kind: 'blocked',
      blockers: ['pending_continuation'],
    });
  });

  it('keeps invalid inference output non-terminal until repair resolves it', () => {
    const value = snapshot({
      steps: [
        {
          ...snapshot().steps[0],
          result: {
            outcome: { kind: 'invalid', reason: 'empty_model_response' },
          },
        },
      ],
    });

    expect(selectTerminalCandidate(value as any)).toEqual({
      kind: 'blocked',
      blockers: ['pending_repair'],
    });
  });

  it('accepts a deterministic partial prepared instead of another inference', () => {
    const value = snapshot({
      result: {
        reply: 'Confirmed partial',
        completionKind: 'partial',
        completionReason: 'partial_budget_exhausted',
      },
      steps: [
        {
          ...snapshot().steps[0],
          result: { outcome: { kind: 'tool_requests', calls: [{}] } },
          continuationProcessed: true,
          terminalCandidatePrepared: true,
        },
      ],
    });

    expect(selectTerminalCandidate(value as any)).toMatchObject({
      kind: 'ready',
      completionKind: 'partial',
      completionReason: 'partial_budget_exhausted',
    });
  });

  it('reports every unresolved complex-terminal dependency', () => {
    const value = snapshot({
      steps: [
        {
          ...snapshot().steps[0],
          status: ExecutionStepStatus.RESULT_RECEIVED,
        },
      ],
      operationStatuses: [
        ExecutionOperationStatus.DISPATCHED,
        ExecutionOperationStatus.UNKNOWN,
      ],
      pendingConfirmations: 1,
      unmaterializedToolPlans: 1,
      activeChildren: 1,
      result: null,
    });

    expect(selectTerminalCandidate(value as any)).toEqual({
      kind: 'blocked',
      blockers: [
        'active_steps',
        'pending_confirmation',
        'unmaterialized_tool_plan',
        'active_child',
        'unresolved_operation',
        'missing_result',
      ],
    });
  });
});

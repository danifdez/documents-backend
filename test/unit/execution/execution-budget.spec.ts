import { BadRequestException, ConflictException } from '@nestjs/common';
import { ExecutionEntity } from '../../../src/execution/execution.entity';
import { ExecutionEventEntity } from '../../../src/execution/execution-event.entity';
import { ExecutionStepAttemptEntity } from '../../../src/execution/execution-step-attempt.entity';
import { ExecutionStepAttemptStatus } from '../../../src/execution/execution-step-attempt-status.enum';
import { ExecutionStepEntity } from '../../../src/execution/execution-step.entity';
import {
  assertOperationBudgetProjection,
  governedBudgetStart,
} from '../../../src/execution/inference-budget-policy';
import {
  ProgressEvent,
  exactToolRepeatGuardSnapshot,
  projectExecutionProgress,
} from '../../../src/execution/execution-progress';
import {
  contentHash,
  ExecutionService,
} from '../../../src/execution/execution.service';
import { ExecutionProgressService } from '../../../src/execution/execution-progress.service';
import { ExecutionStatus } from '../../../src/execution/execution-status.enum';

const EXECUTION_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca701';
const TURN_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca702';
const ATTEMPT_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca703';

describe('ExecutionProgressService operation budget', () => {
  let service: ExecutionProgressService;
  let executionService: ExecutionService;
  let execution: Record<string, any>;
  let rows: any[];

  const validateBudgetStart = (event: Record<string, unknown>) => {
    const identity = governedBudgetStart(execution as ExecutionEntity, event);
    if (!identity) return;
    const progress = projectExecutionProgress(
      rows.map((row) => row.envelope as ProgressEvent),
    );
    assertOperationBudgetProjection(
      identity,
      progress.ledger.operationBudget,
      exactToolRepeatGuardSnapshot(progress.ledger, identity.grantId),
    );
  };

  beforeEach(() => {
    rows = [];
    execution = {
      executionId: EXECUTION_ID,
      rootExecutionId: EXECUTION_ID,
      turnId: TURN_ID,
      taskType: 'assistant-chat',
      status: ExecutionStatus.RUNNING,
      attemptId: ATTEMPT_ID,
      lastSequence: '0',
      lastEventId: null,
      progressPolicy: null,
      progressLedger: null,
    };
    const executionRepo = {
      findOne: jest.fn(async () => execution),
      save: jest.fn(async (value) => value),
    };
    const eventRepo = {
      find: jest.fn(async () => [...rows]),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => {
        rows.push(value);
        return value;
      }),
    };
    const attemptRepo = {
      findOneBy: jest.fn(async ({ attemptId, executionId }) =>
        attemptId === ATTEMPT_ID && executionId === EXECUTION_ID
          ? {
              attemptId: ATTEMPT_ID,
              executionId: EXECUTION_ID,
              stepId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca704',
              status: ExecutionStepAttemptStatus.RUNNING,
              leaseExpiresAt: new Date(Date.now() + 60_000),
            }
          : null,
      ),
    };
    const stepRepo = {
      findOneBy: jest.fn(async () => ({ currentAttemptId: ATTEMPT_ID })),
    };
    const manager = {
      getRepository: jest.fn((entity) =>
        entity === ExecutionEntity
          ? executionRepo
          : entity === ExecutionEventEntity
            ? eventRepo
            : entity === ExecutionStepAttemptEntity
              ? attemptRepo
              : entity === ExecutionStepEntity
                ? stepRepo
                : undefined,
      ),
      save: jest.fn(async (value) => {
        if (value?.eventId) rows.push(value);
        return value;
      }),
    };
    service = Object.create(ExecutionProgressService.prototype);
    executionService = Object.create(ExecutionService.prototype);
    (service as any).dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
    };
    (service as any).config = {
      get: jest.fn((name: string) => {
        if (name === 'PROGRESS_CHAT_MAX_NORMAL_INFERENCES') return '1';
        if (name === 'PROGRESS_CHAT_MAX_TOOL_CALLS') return '1';
        return undefined;
      }),
    };
  });

  const grantRequest = () => ({
    executionId: EXECUTION_ID,
    turnId: TURN_ID,
    loopId: EXECUTION_ID,
    agentName: 'assistant',
    loopKind: 'top_level' as const,
    requestedPolicy: {
      normal: 3,
      normalInferenceSoftLimit: 2,
      repair: 1,
      closing: 1,
      maxTokensPerInference: 1000,
      toolCalls: 6,
      toolCallSoftLimit: 4,
      exactToolRepeatWarning: true,
      exactToolRepeatBlockAfterWarning: true,
      exactToolRepeatTerminateAfterBlock: false,
    },
  });

  const reserveAndStartTool = async (
    grantId: string,
    operationId: string,
    toolCallId: string,
    fingerprint: string,
    round: number,
    name = 'folder_read',
  ) => {
    const decision = await service.reserveOperationBudget(EXECUTION_ID, {
      executionId: EXECUTION_ID,
      loopId: EXECUTION_ID,
      grantId,
      operationId,
      operationKind: 'tool_call',
      bucket: 'tool',
      toolCallId,
      operationFingerprint: fingerprint,
      operationFingerprintVersion: 'canonical_tool_input_v1',
      toolBatchSize: 1,
      toolBatchIndex: 0,
      phase: 'agent_loop',
      round,
      name,
    });
    const attemptId = `018f1d8a-54d7-7d63-a1ee-${String(800 + round).padStart(12, '0')}`;
    const sequence = Number(execution.lastSequence) + 1;
    rows.push({
      sequence: String(sequence),
      executionId: EXECUTION_ID,
      operationId,
      eventType: 'operation.started',
      envelope: {
        sequence,
        eventType: 'operation.started',
        operationId,
        attemptId,
        toolCallId,
        payload: {
          operationKind: 'tool_call',
          loopId: EXECUTION_ID,
          loopKind: 'top_level',
          phase: 'agent_loop',
          name,
          round,
          budgetGrantId: grantId,
          budgetReservationId: decision.reservation.reservationId,
          budgetBucket: 'tool',
          operationFingerprint: fingerprint,
          operationFingerprintVersion: 'canonical_tool_input_v1',
          toolBatchSize: 1,
          toolBatchIndex: 0,
        },
      },
    });
    execution.lastSequence = String(sequence);
    return { decision, attemptId };
  };

  const finishTool = (
    operationId: string,
    attemptId: string,
    status: 'succeeded' | 'failed' | 'cancelled' | 'unknown',
    result: Record<string, unknown> = { value: 'fixture' },
    resultHash?: string,
  ) => {
    if (resultHash) {
      const sourceSequence = Number(execution.lastSequence) + 1;
      rows.push({
        sequence: String(sourceSequence),
        executionId: EXECUTION_ID,
        operationId,
        eventType: 'source.observed',
        envelope: {
          sequence: sourceSequence,
          eventType: 'source.observed',
          operationId,
          attemptId,
          payload: {
            kind: 'tool_output',
            contentHash: resultHash,
          },
        },
      });
      execution.lastSequence = String(sourceSequence);
    }
    const sequence = Number(execution.lastSequence) + 1;
    rows.push({
      sequence: String(sequence),
      executionId: EXECUTION_ID,
      operationId,
      eventType: 'operation.finished',
      envelope: {
        sequence,
        eventType: 'operation.finished',
        operationId,
        attemptId,
        payload: {
          operationKind: 'tool_call',
          status,
          result,
          error: status === 'failed' ? { code: 'tool_failed' } : null,
        },
      },
    });
    execution.lastSequence = String(sequence);
  };

  it('accepts only durable leaf-tool evidence for a runtime partial', () => {
    const reply = 'Completed work: Document read';
    const artifactId = '018f1d8a-54d7-7d63-a1ee-5e9a6adca714';
    const operationId = '018f1d8a-54d7-7d63-a1ee-5e9a6adca710';
    const toolCallId = '018f1d8a-54d7-7d63-a1ee-5e9a6adca711';
    const grantId = '018f1d8a-54d7-7d63-a1ee-5e9a6adca712';
    rows = [
      {
        sequence: '1',
        executionId: EXECUTION_ID,
        operationId,
        eventType: 'operation.started',
        envelope: {
          toolCallId,
          payload: {
            operationKind: 'tool_call',
            name: 'folder_read',
            loopKind: 'top_level',
            loopId: EXECUTION_ID,
            budgetGrantId: grantId,
          },
        },
      },
      {
        sequence: '2',
        executionId: EXECUTION_ID,
        operationId,
        eventType: 'operation.finished',
        envelope: {
          payload: {
            operationKind: 'tool_call',
            status: 'succeeded',
            result: { value: 'fixture' },
            resultSummary: 'Document read',
            resultSummaryKind: 'leaf_tool',
          },
        },
      },
      {
        sequence: '3',
        executionId: EXECUTION_ID,
        operationId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca713',
        eventType: 'operation.started',
        envelope: {
          payload: {
            operationKind: 'inference',
            phase: 'forced_finalization',
            loopId: EXECUTION_ID,
            budgetGrantId: grantId,
          },
        },
      },
      {
        sequence: '4',
        executionId: EXECUTION_ID,
        operationId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca713',
        eventType: 'operation.finished',
        envelope: {
          payload: {
            operationKind: 'inference',
            status: 'succeeded',
            outcome: 'invalid',
            reason: 'empty_model_response',
            result: {},
          },
        },
      },
      {
        sequence: '5',
        executionId: EXECUTION_ID,
        operationId: null,
        eventType: 'message.recorded',
        envelope: {
          actor: { type: 'system' },
          payload: {
            messageKind: 'final_response',
            generationSource: 'runtime_template',
            contentPreview: reply,
            contentArtifactId: artifactId,
          },
          artifactRefs: [artifactId],
        },
      },
    ];
    const artifacts = [
      {
        artifactId,
        rootExecutionId: EXECUTION_ID,
        kind: 'model_response',
        mediaType: 'text/plain',
        body: Buffer.from(reply),
        contentHash: contentHash(reply),
        size: String(Buffer.byteLength(reply)),
      },
    ];
    const completion = {
      kind: 'partial' as const,
      reason: 'budget_exhausted',
      source: 'runtime_template' as const,
      partialResult: {
        version: '1' as const,
        trigger: 'closing_output_empty' as const,
        loopId: EXECUTION_ID,
        grantId,
        completedOperations: [
          {
            operationId,
            toolCallId,
            name: 'folder_read',
            summary: 'Document read',
          },
        ],
        pending: ['final_synthesis'] as ['final_synthesis'],
      },
    };

    expect(() =>
      (executionService as any).assertDeterministicPartial(
        execution,
        rows,
        artifacts,
        reply,
        null,
        completion,
      ),
    ).not.toThrow();
    rows[3].envelope.payload.reason = 'transport_error';
    expect(() =>
      (executionService as any).assertDeterministicPartial(
        execution,
        rows,
        artifacts,
        reply,
        null,
        completion,
      ),
    ).toThrow(BadRequestException);
    rows[3].envelope.payload.reason = 'empty_model_response';
    completion.partialResult.completedOperations[0].summary = 'Invented';
    expect(() =>
      (executionService as any).assertDeterministicPartial(
        execution,
        rows,
        artifacts,
        reply,
        null,
        completion,
      ),
    ).toThrow(BadRequestException);
    completion.partialResult.completedOperations[0].summary = 'Document read';
    expect(() =>
      (executionService as any).assertDeterministicPartial(
        execution,
        rows,
        artifacts,
        'Different reply',
        null,
        completion,
      ),
    ).toThrow(BadRequestException);
  });

  it('requires durable termination evidence for a loop-detected failure', () => {
    const completion = { reason: 'loop_detected' };
    const termination = {
      executionId: EXECUTION_ID,
      eventType: 'progress.reported',
      envelope: {
        payload: {
          kind: 'loop_guard_triggered',
          loopGuardSignal: {
            action: 'terminate',
          },
        },
      },
    };

    expect(() =>
      (executionService as any).assertLoopDetectedCompletion(
        execution,
        [termination],
        'Immediate exact tool repeat persisted',
        completion,
      ),
    ).not.toThrow();
    expect(() =>
      (executionService as any).assertLoopDetectedCompletion(
        execution,
        [],
        'Immediate exact tool repeat persisted',
        completion,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      (executionService as any).assertLoopDetectedCompletion(
        execution,
        [termination],
        null,
        completion,
      ),
    ).toThrow(BadRequestException);
  });

  it('accepts only the strategy-change shape for loop partials', () => {
    const partial = {
      version: '1',
      trigger: 'exact_tool_repeat_persisted',
      loopId: EXECUTION_ID,
      grantId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca704',
      completedOperations: [
        {
          operationId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca705',
          toolCallId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca706',
          name: 'folder_read',
          summary: 'Document read',
        },
      ],
      pending: ['strategy_change'],
      continuation: {
        kind: 'new_turn',
        reason: 'different_strategy_required',
      },
    };
    expect(() =>
      (executionService as any).assertPartialShape(partial, execution),
    ).not.toThrow();
    expect(() =>
      (executionService as any).assertPartialShape(
        { ...partial, pending: ['final_synthesis'] },
        execution,
      ),
    ).toThrow(BadRequestException);
  });

  it('caps the grant and denies a second reservation without resetting saldo', async () => {
    const firstGrant = await service.requestProgressGrant(
      EXECUTION_ID,
      grantRequest(),
    );
    const repeatedGrant = await service.requestProgressGrant(
      EXECUTION_ID,
      grantRequest(),
    );
    expect(firstGrant.grant.effectivePolicy.normal).toBe(1);
    expect(firstGrant.grant.effectivePolicy.toolCalls).toBe(1);
    expect(firstGrant.grant.effectivePolicy.toolCallSoftLimit).toBe(0);
    expect(repeatedGrant.grant.grantId).toBe(firstGrant.grant.grantId);

    const baseReservation = {
      executionId: EXECUTION_ID,
      loopId: EXECUTION_ID,
      grantId: firstGrant.grant.grantId,
      operationKind: 'inference' as const,
      bucket: 'normal' as const,
      phase: 'agent_loop',
      round: 1,
      name: 'chat_with_tools',
    };
    const first = await service.reserveOperationBudget(EXECUTION_ID, {
      ...baseReservation,
      operationId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca704',
    });
    const denied = await service.reserveOperationBudget(EXECUTION_ID, {
      ...baseReservation,
      operationId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca705',
    });

    expect(first.granted).toBe(true);
    expect(denied.granted).toBe(false);
    expect(denied.reservation.reason).toBe('budget_hard_limit_reached');
    expect(
      execution.progressLedger.operationBudget.grants[firstGrant.grant.grantId]
        .usage.normal,
    ).toEqual({
      granted: 1,
      reserved: 1,
      consumed: 0,
      available: 0,
      softLimit: 0,
      softLimitReached: false,
      softLimitWarningPending: false,
    });

    const repeatedReservation = await service.reserveOperationBudget(
      EXECUTION_ID,
      {
        ...baseReservation,
        operationId: first.reservation.operationId,
      },
    );
    expect(repeatedReservation.reservation.reservationId).toBe(
      first.reservation.reservationId,
    );
    expect(repeatedReservation.granted).toBe(true);
  });

  it('records the tool soft limit once and returns its durable snapshot', async () => {
    (service as any).config.get = jest.fn((name: string) => {
      if (name === 'PROGRESS_CHAT_MAX_NORMAL_INFERENCES') return '1';
      if (name === 'PROGRESS_CHAT_MAX_TOOL_CALLS') return '6';
      if (name === 'PROGRESS_CHAT_TOOL_CALL_SOFT_LIMIT') return '4';
      return undefined;
    });
    const { grant, budgetState } = await service.requestProgressGrant(
      EXECUTION_ID,
      grantRequest(),
    );
    expect(grant.effectivePolicy.toolCallSoftLimit).toBe(4);
    expect(budgetState.tool).toMatchObject({
      granted: 6,
      available: 6,
      softLimit: 4,
      softLimitReached: false,
    });

    const decisions = [];
    for (let index = 0; index < 4; index += 1) {
      decisions.push(
        await service.reserveOperationBudget(EXECUTION_ID, {
          executionId: EXECUTION_ID,
          loopId: EXECUTION_ID,
          grantId: grant.grantId,
          operationId: `018f1d8a-54d7-7d63-a1ee-5e9a6adca73${index}`,
          operationKind: 'tool_call',
          bucket: 'tool',
          toolCallId: `018f1d8a-54d7-7d63-a1ee-5e9a6adca74${index}`,
          phase: 'agent_loop',
          round: index + 1,
          name: 'folder_read',
        }),
      );
    }

    expect(decisions.slice(0, 3).every((item) => !item.softLimitSignal)).toBe(
      true,
    );
    expect(decisions[3]).toMatchObject({
      granted: true,
      budgetState: {
        tool: {
          available: 2,
          softLimit: 4,
          softLimitReached: true,
          softLimitTriggeringOperationId:
            '018f1d8a-54d7-7d63-a1ee-5e9a6adca733',
        },
      },
      softLimitSignal: {
        bucket: 'tool',
        softLimit: 4,
        hardLimit: 6,
        committed: 4,
        available: 2,
      },
    });
    expect(
      rows.filter(
        (row) => row.envelope.payload.kind === 'budget_soft_limit_reached',
      ),
    ).toHaveLength(1);

    const recoveredGrant = await service.requestProgressGrant(
      EXECUTION_ID,
      grantRequest(),
    );
    expect(recoveredGrant.budgetState.tool).toMatchObject({
      available: 2,
      softLimitReached: true,
      softLimitTriggeringOperationId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca733',
    });

    const repeated = await service.reserveOperationBudget(EXECUTION_ID, {
      executionId: EXECUTION_ID,
      loopId: EXECUTION_ID,
      grantId: grant.grantId,
      operationId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca733',
      operationKind: 'tool_call',
      bucket: 'tool',
      toolCallId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca743',
      phase: 'agent_loop',
      round: 4,
      name: 'folder_read',
    });
    expect(repeated.softLimitSignal?.triggeringOperationId).toBe(
      '018f1d8a-54d7-7d63-a1ee-5e9a6adca733',
    );
    expect(
      rows.filter(
        (row) => row.envelope.payload.kind === 'budget_soft_limit_reached',
      ),
    ).toHaveLength(1);
  });

  it('warns on the inference that crosses the normal soft limit', async () => {
    (service as any).config.get = jest.fn((name: string) => {
      if (name === 'PROGRESS_CHAT_MAX_NORMAL_INFERENCES') return '3';
      if (name === 'PROGRESS_CHAT_NORMAL_INFERENCE_SOFT_LIMIT') return '2';
      if (name === 'PROGRESS_CHAT_MAX_TOOL_CALLS') return '0';
      return undefined;
    });
    const { grant, budgetState } = await service.requestProgressGrant(
      EXECUTION_ID,
      grantRequest(),
    );
    expect(grant.effectivePolicy.normalInferenceSoftLimit).toBe(2);
    expect(budgetState.normal).toMatchObject({
      granted: 3,
      available: 3,
      softLimit: 2,
      softLimitReached: false,
      softLimitWarningPending: false,
    });

    const reserve = (operationId: string, round: number) =>
      service.reserveOperationBudget(EXECUTION_ID, {
        executionId: EXECUTION_ID,
        loopId: EXECUTION_ID,
        grantId: grant.grantId,
        operationId,
        operationKind: 'inference',
        bucket: 'normal',
        phase: 'agent_loop',
        round,
        name: 'chat_with_tools',
      });
    const first = await reserve('018f1d8a-54d7-7d63-a1ee-5e9a6adca750', 1);
    const second = await reserve('018f1d8a-54d7-7d63-a1ee-5e9a6adca751', 2);

    expect(first.softLimitSignal).toBeUndefined();
    expect(second).toMatchObject({
      softLimitSignal: {
        operationKind: 'inference',
        bucket: 'normal',
        softLimit: 2,
        hardLimit: 3,
        available: 1,
      },
      budgetState: {
        normal: {
          softLimitReached: true,
          softLimitWarningPending: true,
        },
      },
    });

    const start = {
      eventType: 'operation.started',
      operationId: second.reservation.operationId,
      payload: {
        operationKind: 'inference',
        loopId: EXECUTION_ID,
        loopKind: 'top_level',
        phase: 'agent_loop',
        name: 'chat_with_tools',
        round: 2,
        budgetGrantId: grant.grantId,
        budgetReservationId: second.reservation.reservationId,
        budgetBucket: 'normal',
      },
    };
    expect(() => validateBudgetStart(start)).toThrow(ConflictException);
    expect(() =>
      validateBudgetStart({
        ...start,
        payload: {
          ...start.payload,
          budgetSoftLimitWarningApplied: true,
        },
      }),
    ).not.toThrow();

    rows.push({
      envelope: {
        sequence: Number(execution.lastSequence) + 1,
        ...start,
        attemptId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca752',
        payload: {
          ...start.payload,
          budgetSoftLimitWarningApplied: true,
        },
      },
    });
    const recovered = await service.requestProgressGrant(
      EXECUTION_ID,
      grantRequest(),
    );
    expect(recovered.budgetState.normal).toMatchObject({
      available: 1,
      softLimitReached: true,
      softLimitWarningPending: false,
    });
  });

  it('keeps historical grants compatible with the soft limit disabled', async () => {
    (service as any).config.get = jest.fn((name: string) => {
      if (name === 'PROGRESS_CHAT_MAX_TOOL_CALLS') return '6';
      if (name === 'PROGRESS_CHAT_TOOL_CALL_SOFT_LIMIT') return '4';
      return undefined;
    });
    await service.requestProgressGrant(EXECUTION_ID, grantRequest());
    const storedGrant = rows[0].envelope.payload.grant;
    delete storedGrant.requestedPolicy.normalInferenceSoftLimit;
    delete storedGrant.effectivePolicy.normalInferenceSoftLimit;
    delete storedGrant.requestedPolicy.toolCallSoftLimit;
    delete storedGrant.effectivePolicy.toolCallSoftLimit;
    delete storedGrant.requestedPolicy.exactToolRepeatWarning;
    delete storedGrant.effectivePolicy.exactToolRepeatWarning;
    delete storedGrant.requestedPolicy.exactToolRepeatBlockAfterWarning;
    delete storedGrant.effectivePolicy.exactToolRepeatBlockAfterWarning;

    const repeated = await service.requestProgressGrant(
      EXECUTION_ID,
      grantRequest(),
    );

    expect(repeated.grant.requestedPolicy.normalInferenceSoftLimit).toBe(0);
    expect(repeated.grant.effectivePolicy.normalInferenceSoftLimit).toBe(0);
    expect(repeated.grant.requestedPolicy.toolCallSoftLimit).toBe(0);
    expect(repeated.grant.effectivePolicy.toolCallSoftLimit).toBe(0);
    expect(repeated.grant.requestedPolicy.exactToolRepeatWarning).toBe(false);
    expect(repeated.grant.effectivePolicy.exactToolRepeatWarning).toBe(false);
    expect(
      repeated.grant.effectivePolicy.exactToolRepeatBlockAfterWarning,
    ).toBe(false);
    expect(repeated.budgetState.tool).toMatchObject({
      softLimit: 0,
      softLimitReached: false,
    });
    expect(repeated.budgetState.normal).toMatchObject({
      softLimit: 0,
      softLimitReached: false,
      softLimitWarningPending: false,
    });
  });

  it('accepts a grant request from an older worker without the repeat flag', async () => {
    const request = grantRequest();
    delete request.requestedPolicy.exactToolRepeatWarning;
    delete request.requestedPolicy.exactToolRepeatBlockAfterWarning;
    delete request.requestedPolicy.exactToolRepeatTerminateAfterBlock;

    const { grant, guardState } = await service.requestProgressGrant(
      EXECUTION_ID,
      request,
    );

    expect(grant.requestedPolicy.exactToolRepeatWarning).toBeUndefined();
    expect(grant.effectivePolicy.exactToolRepeatWarning).toBe(false);
    expect(grant.effectivePolicy.exactToolRepeatBlockAfterWarning).toBe(false);
    expect(guardState).toEqual({
      detections: 0,
      warningIssued: false,
      warningPending: false,
      blocks: 0,
      blockResultPending: false,
      terminations: 0,
    });
  });

  it('does not enable a soft limit that models explicitly disabled', async () => {
    (service as any).config.get = jest.fn((name: string) => {
      if (name === 'PROGRESS_CHAT_MAX_TOOL_CALLS') return '6';
      if (name === 'PROGRESS_CHAT_TOOL_CALL_SOFT_LIMIT') return '4';
      return undefined;
    });
    const request = grantRequest();
    request.requestedPolicy.toolCallSoftLimit = 0;

    const { grant } = await service.requestProgressGrant(EXECUTION_ID, request);

    expect(grant.effectivePolicy.toolCallSoftLimit).toBe(0);
  });

  it('reserves the last tool slot and validates it before dispatch', async () => {
    const { grant } = await service.requestProgressGrant(
      EXECUTION_ID,
      grantRequest(),
    );
    const operationId = '018f1d8a-54d7-7d63-a1ee-5e9a6adca720';
    const toolCallId = '018f1d8a-54d7-7d63-a1ee-5e9a6adca721';
    const base = {
      executionId: EXECUTION_ID,
      loopId: EXECUTION_ID,
      grantId: grant.grantId,
      operationKind: 'tool_call' as const,
      bucket: 'tool' as const,
      toolCallId,
      phase: 'agent_loop',
      round: 1,
      name: 'folder_read',
    };
    const accepted = await service.reserveOperationBudget(EXECUTION_ID, {
      ...base,
      operationId,
    });
    const denied = await service.reserveOperationBudget(EXECUTION_ID, {
      ...base,
      operationId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca722',
      toolCallId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca723',
    });

    expect(accepted.granted).toBe(true);
    expect(denied).toMatchObject({
      granted: false,
      reservation: { reason: 'tool_budget_hard_limit_reached' },
    });
    const event = {
      eventType: 'operation.started',
      operationId,
      toolCallId,
      payload: {
        operationKind: 'tool_call',
        loopId: EXECUTION_ID,
        loopKind: 'top_level',
        phase: 'agent_loop',
        name: 'folder_read',
        round: 1,
        budgetGrantId: grant.grantId,
        budgetReservationId: accepted.reservation.reservationId,
        budgetBucket: 'tool',
      },
    };

    expect(() => validateBudgetStart(event)).not.toThrow();
    expect(() =>
      validateBudgetStart({
        ...event,
        toolCallId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca724',
      }),
    ).toThrow(ConflictException);
  });

  it('records one exact-repeat signal and requires its next normal warning', async () => {
    (service as any).config.get = jest.fn((name: string) => {
      if (name === 'PROGRESS_CHAT_MAX_NORMAL_INFERENCES') return '3';
      if (name === 'PROGRESS_CHAT_MAX_TOOL_CALLS') return '3';
      if (name === 'PROGRESS_CHAT_EXACT_TOOL_REPEAT_WARNING') return '1';
      return undefined;
    });
    const { grant } = await service.requestProgressGrant(
      EXECUTION_ID,
      grantRequest(),
    );
    const fingerprint = `sha256:${'a'.repeat(64)}`;
    const firstOperationId = '018f1d8a-54d7-7d63-a1ee-5e9a6adca760';
    const secondOperationId = '018f1d8a-54d7-7d63-a1ee-5e9a6adca761';
    const base = {
      executionId: EXECUTION_ID,
      loopId: EXECUTION_ID,
      grantId: grant.grantId,
      operationKind: 'tool_call' as const,
      bucket: 'tool' as const,
      operationFingerprint: fingerprint,
      operationFingerprintVersion: 'canonical_tool_input_v1' as const,
      toolBatchSize: 1,
      toolBatchIndex: 0,
      phase: 'agent_loop',
      name: 'folder_read',
    };
    const first = await service.reserveOperationBudget(EXECUTION_ID, {
      ...base,
      operationId: firstOperationId,
      toolCallId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca762',
      round: 1,
    });
    const firstAttemptId = '018f1d8a-54d7-7d63-a1ee-5e9a6adca763';
    rows.push(
      {
        producerComponent: 'documents-models',
        producerSequence: '1',
        eventId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca764',
        envelope: {
          sequence: 3,
          eventType: 'operation.started',
          operationId: firstOperationId,
          attemptId: firstAttemptId,
          payload: {
            operationKind: 'tool_call',
            loopId: EXECUTION_ID,
            loopKind: 'top_level',
            phase: 'agent_loop',
            name: 'folder_read',
            round: 1,
            budgetGrantId: grant.grantId,
            budgetReservationId: first.reservation.reservationId,
            budgetBucket: 'tool',
            operationFingerprint: fingerprint,
            operationFingerprintVersion: 'canonical_tool_input_v1',
          },
        },
      },
      {
        producerComponent: 'documents-models',
        producerSequence: '2',
        eventId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca765',
        envelope: {
          sequence: 4,
          eventType: 'operation.finished',
          operationId: firstOperationId,
          attemptId: firstAttemptId,
          payload: {
            operationKind: 'tool_call',
            status: 'succeeded',
            result: { summary: 'Folder read' },
          },
        },
      },
    );
    execution.lastSequence = '4';

    const repeated = await service.reserveOperationBudget(EXECUTION_ID, {
      ...base,
      operationId: secondOperationId,
      toolCallId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca766',
      round: 2,
    });
    expect(repeated).toMatchObject({
      granted: true,
      loopGuardSignal: {
        previousOperationId: firstOperationId,
        triggeringOperationId: secondOperationId,
      },
      guardState: {
        detections: 1,
        warningIssued: true,
        warningPending: true,
      },
    });
    const idempotent = await service.reserveOperationBudget(EXECUTION_ID, {
      ...base,
      operationId: secondOperationId,
      toolCallId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca766',
      round: 2,
    });
    expect(idempotent.loopGuardSignal).toEqual(repeated.loopGuardSignal);
    expect(
      rows.filter(
        (row) => row.envelope.payload.kind === 'loop_guard_triggered',
      ),
    ).toHaveLength(1);

    const secondAttemptId = '018f1d8a-54d7-7d63-a1ee-5e9a6adca767';
    rows.push({
      producerComponent: 'documents-models',
      producerSequence: '3',
      eventId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca768',
      envelope: {
        sequence: 7,
        eventType: 'operation.started',
        operationId: secondOperationId,
        attemptId: secondAttemptId,
        payload: {
          operationKind: 'tool_call',
          loopId: EXECUTION_ID,
          loopKind: 'top_level',
          phase: 'agent_loop',
          name: 'folder_read',
          round: 2,
          budgetGrantId: grant.grantId,
          budgetReservationId: repeated.reservation.reservationId,
          budgetBucket: 'tool',
          operationFingerprint: fingerprint,
          operationFingerprintVersion: 'canonical_tool_input_v1',
        },
      },
    });
    execution.lastSequence = '7';
    const inference = await service.reserveOperationBudget(EXECUTION_ID, {
      executionId: EXECUTION_ID,
      loopId: EXECUTION_ID,
      grantId: grant.grantId,
      operationId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca769',
      operationKind: 'inference',
      bucket: 'normal',
      phase: 'agent_loop',
      round: 3,
      name: 'chat_with_tools',
    });
    expect(inference.budgetState.normal).toMatchObject({
      reserved: 1,
      softLimitWarningPending: false,
    });
    const inferenceStart = {
      eventType: 'operation.started',
      operationId: inference.reservation.operationId,
      payload: {
        operationKind: 'inference',
        loopId: EXECUTION_ID,
        loopKind: 'top_level',
        phase: 'agent_loop',
        name: 'chat_with_tools',
        round: 3,
        budgetGrantId: grant.grantId,
        budgetReservationId: inference.reservation.reservationId,
        budgetBucket: 'normal',
      },
    };
    expect(() => validateBudgetStart(inferenceStart)).toThrow(
      ConflictException,
    );
    expect(() =>
      validateBudgetStart({
        ...inferenceStart,
        payload: {
          ...inferenceStart.payload,
          loopGuardWarningApplied: true,
        },
      }),
    ).not.toThrow();
  });

  it('blocks a repeated tool after its warning when both prior results match', async () => {
    (service as any).config.get = jest.fn((name: string) => {
      if (name === 'PROGRESS_CHAT_MAX_NORMAL_INFERENCES') return '3';
      if (name === 'PROGRESS_CHAT_MAX_TOOL_CALLS') return '6';
      if (name === 'PROGRESS_CHAT_EXACT_TOOL_REPEAT_WARNING') return '1';
      if (name === 'PROGRESS_CHAT_EXACT_TOOL_REPEAT_BLOCK_AFTER_WARNING') {
        return '1';
      }
      if (name === 'PROGRESS_CHAT_EXACT_TOOL_REPEAT_TERMINATE_AFTER_BLOCK') {
        return '1';
      }
      return undefined;
    });
    const request = grantRequest();
    request.requestedPolicy.exactToolRepeatTerminateAfterBlock = true;
    const { grant } = await service.requestProgressGrant(EXECUTION_ID, request);
    expect(grant.effectivePolicy.exactToolRepeatTerminateAfterBlock).toBe(true);
    const fingerprint = `sha256:${'f'.repeat(64)}`;
    const resultHash = `sha256:${'1'.repeat(64)}`;
    const firstOperationId = '018f1d8a-54d7-7d63-a1ee-000000000901';
    const first = await reserveAndStartTool(
      grant.grantId,
      firstOperationId,
      '018f1d8a-54d7-7d63-a1ee-000000000902',
      fingerprint,
      1,
    );
    finishTool(
      firstOperationId,
      first.attemptId,
      'succeeded',
      { value: 'stable' },
      resultHash,
    );
    const secondOperationId = '018f1d8a-54d7-7d63-a1ee-000000000903';
    const second = await reserveAndStartTool(
      grant.grantId,
      secondOperationId,
      '018f1d8a-54d7-7d63-a1ee-000000000904',
      fingerprint,
      2,
    );
    expect(second.decision.loopGuardSignal).toMatchObject({ action: 'warn' });
    finishTool(
      secondOperationId,
      second.attemptId,
      'succeeded',
      { value: 'stable' },
      resultHash,
    );
    const inferenceOperationId = '018f1d8a-54d7-7d63-a1ee-000000000905';
    const inference = await service.reserveOperationBudget(EXECUTION_ID, {
      executionId: EXECUTION_ID,
      loopId: EXECUTION_ID,
      grantId: grant.grantId,
      operationId: inferenceOperationId,
      operationKind: 'inference',
      bucket: 'normal',
      phase: 'agent_loop',
      round: 3,
      name: 'chat_with_tools',
    });
    const inferenceSequence = Number(execution.lastSequence) + 1;
    rows.push({
      sequence: String(inferenceSequence),
      executionId: EXECUTION_ID,
      operationId: inferenceOperationId,
      eventType: 'operation.started',
      envelope: {
        sequence: inferenceSequence,
        eventType: 'operation.started',
        operationId: inferenceOperationId,
        attemptId: '018f1d8a-54d7-7d63-a1ee-000000000906',
        payload: {
          operationKind: 'inference',
          loopId: EXECUTION_ID,
          loopKind: 'top_level',
          phase: 'agent_loop',
          name: 'chat_with_tools',
          round: 3,
          budgetGrantId: grant.grantId,
          budgetReservationId: inference.reservation.reservationId,
          budgetBucket: 'normal',
          loopGuardWarningApplied: true,
        },
      },
    });
    execution.lastSequence = String(inferenceSequence);
    const blockedOperationId = '018f1d8a-54d7-7d63-a1ee-000000000907';
    const blockRequest = {
      executionId: EXECUTION_ID,
      loopId: EXECUTION_ID,
      grantId: grant.grantId,
      operationId: blockedOperationId,
      operationKind: 'tool_call' as const,
      bucket: 'tool' as const,
      toolCallId: '018f1d8a-54d7-7d63-a1ee-000000000908',
      operationFingerprint: fingerprint,
      operationFingerprintVersion: 'canonical_tool_input_v1' as const,
      toolBatchSize: 1,
      toolBatchIndex: 0,
      phase: 'agent_loop',
      round: 3,
      name: 'folder_read',
    };
    const blocked = await service.reserveOperationBudget(
      EXECUTION_ID,
      blockRequest,
    );

    expect(blocked).toMatchObject({
      granted: false,
      reservation: {
        status: 'denied',
        reason: 'immediate_exact_tool_repeat_blocked',
      },
      budgetState: { tool: { consumed: 2, available: 4 } },
      loopGuardSignal: {
        action: 'block',
        previousOperationId: secondOperationId,
        triggeringOperationId: blockedOperationId,
        warningAppliedToOperationId: inferenceOperationId,
        resultFingerprint: resultHash,
        resultFingerprintVersion: 'tool_output_content_hash_v1',
      },
      guardState: {
        detections: 2,
        blocks: 1,
        warningPending: false,
        lastBlockedOperationId: blockedOperationId,
      },
    });
    expect(
      rows.some(
        (row) =>
          row.envelope.eventType === 'operation.started' &&
          row.envelope.operationId === blockedOperationId,
      ),
    ).toBe(false);

    const replay = await service.reserveOperationBudget(
      EXECUTION_ID,
      blockRequest,
    );
    expect(replay.loopGuardSignal).toEqual(blocked.loopGuardSignal);
    expect(
      rows.filter(
        (row) => row.envelope.payload.kind === 'loop_guard_triggered',
      ),
    ).toHaveLength(2);

    const applyingOperationId = '018f1d8a-54d7-7d63-a1ee-000000000909';
    const applying = await service.reserveOperationBudget(EXECUTION_ID, {
      executionId: EXECUTION_ID,
      loopId: EXECUTION_ID,
      grantId: grant.grantId,
      operationId: applyingOperationId,
      operationKind: 'inference',
      bucket: 'normal',
      phase: 'agent_loop',
      round: 4,
      name: 'chat_with_tools',
    });
    const applyingSequence = Number(execution.lastSequence) + 1;
    const applyingStart = {
      sequence: String(applyingSequence),
      executionId: EXECUTION_ID,
      operationId: applyingOperationId,
      eventType: 'operation.started',
      envelope: {
        sequence: applyingSequence,
        eventType: 'operation.started',
        operationId: applyingOperationId,
        attemptId: '018f1d8a-54d7-7d63-a1ee-000000000910',
        payload: {
          operationKind: 'inference',
          loopId: EXECUTION_ID,
          loopKind: 'top_level',
          phase: 'agent_loop',
          name: 'chat_with_tools',
          round: 4,
          budgetGrantId: grant.grantId,
          budgetReservationId: applying.reservation.reservationId,
          budgetBucket: 'normal',
          budgetSoftLimitWarningApplied: true,
          loopGuardBlockResultApplied: true,
        },
      },
    };
    expect(() => validateBudgetStart(applyingStart.envelope)).not.toThrow();
    rows.push(applyingStart);
    execution.lastSequence = String(applyingSequence);

    const sameBatchOperationId = '018f1d8a-54d7-7d63-a1ee-000000000911';
    const sameBatch = await service.reserveOperationBudget(EXECUTION_ID, {
      ...blockRequest,
      operationId: sameBatchOperationId,
      toolCallId: '018f1d8a-54d7-7d63-a1ee-000000000912',
      toolBatchSize: 2,
      round: 4,
    });
    expect(sameBatch).toMatchObject({
      granted: false,
      reservation: { reason: 'immediate_exact_tool_repeat_blocked' },
      loopGuardSignal: { action: 'block' },
      guardState: { blockResultPending: true, terminations: 0 },
    });

    const secondApplyingOperationId = '018f1d8a-54d7-7d63-a1ee-000000000913';
    const secondApplying = await service.reserveOperationBudget(EXECUTION_ID, {
      executionId: EXECUTION_ID,
      loopId: EXECUTION_ID,
      grantId: grant.grantId,
      operationId: secondApplyingOperationId,
      operationKind: 'inference',
      bucket: 'normal',
      phase: 'agent_loop',
      round: 5,
      name: 'chat_with_tools',
    });
    const secondApplyingSequence = Number(execution.lastSequence) + 1;
    const secondApplyingStart = {
      sequence: String(secondApplyingSequence),
      executionId: EXECUTION_ID,
      operationId: secondApplyingOperationId,
      eventType: 'operation.started',
      envelope: {
        sequence: secondApplyingSequence,
        eventType: 'operation.started',
        operationId: secondApplyingOperationId,
        attemptId: '018f1d8a-54d7-7d63-a1ee-000000000914',
        payload: {
          operationKind: 'inference',
          loopId: EXECUTION_ID,
          loopKind: 'top_level',
          phase: 'agent_loop',
          name: 'chat_with_tools',
          round: 5,
          budgetGrantId: grant.grantId,
          budgetReservationId: secondApplying.reservation.reservationId,
          budgetBucket: 'normal',
          loopGuardBlockResultApplied: true,
        },
      },
    };
    expect(() =>
      validateBudgetStart(secondApplyingStart.envelope),
    ).not.toThrow();
    rows.push(secondApplyingStart);
    execution.lastSequence = String(secondApplyingSequence);

    const terminalOperationId = '018f1d8a-54d7-7d63-a1ee-000000000915';
    const terminalRequest = {
      ...blockRequest,
      operationId: terminalOperationId,
      toolCallId: '018f1d8a-54d7-7d63-a1ee-000000000916',
      round: 5,
    };
    const terminated = await service.reserveOperationBudget(
      EXECUTION_ID,
      terminalRequest,
    );
    expect(terminated).toMatchObject({
      granted: false,
      reservation: {
        reason: 'immediate_exact_tool_repeat_terminated',
        toolBatchSize: 1,
        toolBatchIndex: 0,
      },
      budgetState: { tool: { consumed: 2, available: 4 } },
      loopGuardSignal: {
        action: 'terminate',
        blockedOperationId: sameBatchOperationId,
        triggeringOperationId: terminalOperationId,
        blockResultAppliedToOperationId: secondApplyingOperationId,
        resultFingerprint: resultHash,
      },
      guardState: {
        blocks: 2,
        blockResultPending: false,
        terminations: 1,
        lastTerminatedOperationId: terminalOperationId,
      },
    });
    const terminalReplay = await service.reserveOperationBudget(
      EXECUTION_ID,
      terminalRequest,
    );
    expect(terminalReplay.loopGuardSignal).toEqual(terminated.loopGuardSignal);
    expect(
      rows.filter(
        (row) => row.envelope.payload.loopGuardSignal?.action === 'terminate',
      ),
    ).toHaveLength(1);
  });

  it('does not block when the repeated tools produced different results', async () => {
    (service as any).config.get = jest.fn((name: string) => {
      if (name === 'PROGRESS_CHAT_MAX_NORMAL_INFERENCES') return '3';
      if (name === 'PROGRESS_CHAT_MAX_TOOL_CALLS') return '6';
      return undefined;
    });
    const { grant } = await service.requestProgressGrant(
      EXECUTION_ID,
      grantRequest(),
    );
    const fingerprint = `sha256:${'2'.repeat(64)}`;
    const firstOperationId = '018f1d8a-54d7-7d63-a1ee-000000000911';
    const first = await reserveAndStartTool(
      grant.grantId,
      firstOperationId,
      '018f1d8a-54d7-7d63-a1ee-000000000912',
      fingerprint,
      1,
    );
    finishTool(
      firstOperationId,
      first.attemptId,
      'succeeded',
      { value: 'first' },
      `sha256:${'3'.repeat(64)}`,
    );
    const secondOperationId = '018f1d8a-54d7-7d63-a1ee-000000000913';
    const second = await reserveAndStartTool(
      grant.grantId,
      secondOperationId,
      '018f1d8a-54d7-7d63-a1ee-000000000914',
      fingerprint,
      2,
    );
    finishTool(
      secondOperationId,
      second.attemptId,
      'succeeded',
      { value: 'second' },
      `sha256:${'4'.repeat(64)}`,
    );
    const inferenceOperationId = '018f1d8a-54d7-7d63-a1ee-000000000915';
    const inference = await service.reserveOperationBudget(EXECUTION_ID, {
      executionId: EXECUTION_ID,
      loopId: EXECUTION_ID,
      grantId: grant.grantId,
      operationId: inferenceOperationId,
      operationKind: 'inference',
      bucket: 'normal',
      phase: 'agent_loop',
      round: 3,
      name: 'chat_with_tools',
    });
    const sequence = Number(execution.lastSequence) + 1;
    rows.push({
      sequence: String(sequence),
      executionId: EXECUTION_ID,
      operationId: inferenceOperationId,
      eventType: 'operation.started',
      envelope: {
        sequence,
        eventType: 'operation.started',
        operationId: inferenceOperationId,
        payload: {
          operationKind: 'inference',
          loopId: EXECUTION_ID,
          loopKind: 'top_level',
          phase: 'agent_loop',
          name: 'chat_with_tools',
          round: 3,
          budgetGrantId: grant.grantId,
          budgetReservationId: inference.reservation.reservationId,
          budgetBucket: 'normal',
          loopGuardWarningApplied: true,
        },
      },
    });
    execution.lastSequence = String(sequence);

    const decision = await service.reserveOperationBudget(EXECUTION_ID, {
      executionId: EXECUTION_ID,
      loopId: EXECUTION_ID,
      grantId: grant.grantId,
      operationId: '018f1d8a-54d7-7d63-a1ee-000000000917',
      operationKind: 'tool_call',
      bucket: 'tool',
      toolCallId: '018f1d8a-54d7-7d63-a1ee-000000000918',
      operationFingerprint: fingerprint,
      operationFingerprintVersion: 'canonical_tool_input_v1',
      phase: 'agent_loop',
      round: 3,
      name: 'folder_read',
    });

    expect(second.decision.loopGuardSignal).toMatchObject({ action: 'warn' });
    expect(decision.granted).toBe(true);
    expect(decision.loopGuardSignal).toBeUndefined();
    expect(decision.guardState.blocks).toBe(0);
  });

  it.each([
    ['failed result', 'failed', { value: 'fixture' }],
    ['unknown result', 'unknown', { value: 'fixture' }],
    ['pending confirmation', 'succeeded', { pendingConfirmation: true }],
  ] as const)(
    'does not signal a repeat after a %s',
    async (_label, status, result) => {
      (service as any).config.get = jest.fn((name: string) => {
        if (name === 'PROGRESS_CHAT_MAX_TOOL_CALLS') return '3';
        if (name === 'PROGRESS_CHAT_EXACT_TOOL_REPEAT_WARNING') return '1';
        return undefined;
      });
      const { grant } = await service.requestProgressGrant(
        EXECUTION_ID,
        grantRequest(),
      );
      const fingerprint = `sha256:${'c'.repeat(64)}`;
      const first = await reserveAndStartTool(
        grant.grantId,
        '018f1d8a-54d7-7d63-a1ee-000000000811',
        '018f1d8a-54d7-7d63-a1ee-000000000812',
        fingerprint,
        1,
      );
      finishTool(
        '018f1d8a-54d7-7d63-a1ee-000000000811',
        first.attemptId,
        status,
        result,
      );

      const repeated = await service.reserveOperationBudget(EXECUTION_ID, {
        executionId: EXECUTION_ID,
        loopId: EXECUTION_ID,
        grantId: grant.grantId,
        operationId: '018f1d8a-54d7-7d63-a1ee-000000000813',
        operationKind: 'tool_call',
        bucket: 'tool',
        toolCallId: '018f1d8a-54d7-7d63-a1ee-000000000814',
        operationFingerprint: fingerprint,
        operationFingerprintVersion: 'canonical_tool_input_v1',
        phase: 'agent_loop',
        round: 2,
        name: 'folder_read',
      });

      expect(repeated.loopGuardSignal).toBeUndefined();
      expect(repeated.guardState.detections).toBe(0);
    },
  );

  it('does not signal when another tool starts between equal calls', async () => {
    (service as any).config.get = jest.fn((name: string) => {
      if (name === 'PROGRESS_CHAT_MAX_TOOL_CALLS') return '4';
      if (name === 'PROGRESS_CHAT_EXACT_TOOL_REPEAT_WARNING') return '1';
      return undefined;
    });
    const { grant } = await service.requestProgressGrant(
      EXECUTION_ID,
      grantRequest(),
    );
    const fingerprint = `sha256:${'d'.repeat(64)}`;
    const otherFingerprint = `sha256:${'e'.repeat(64)}`;
    const first = await reserveAndStartTool(
      grant.grantId,
      '018f1d8a-54d7-7d63-a1ee-000000000821',
      '018f1d8a-54d7-7d63-a1ee-000000000822',
      fingerprint,
      1,
    );
    finishTool(
      '018f1d8a-54d7-7d63-a1ee-000000000821',
      first.attemptId,
      'succeeded',
    );
    const intermediate = await reserveAndStartTool(
      grant.grantId,
      '018f1d8a-54d7-7d63-a1ee-000000000823',
      '018f1d8a-54d7-7d63-a1ee-000000000824',
      otherFingerprint,
      2,
      'file_read',
    );
    finishTool(
      '018f1d8a-54d7-7d63-a1ee-000000000823',
      intermediate.attemptId,
      'succeeded',
    );

    const repeated = await service.reserveOperationBudget(EXECUTION_ID, {
      executionId: EXECUTION_ID,
      loopId: EXECUTION_ID,
      grantId: grant.grantId,
      operationId: '018f1d8a-54d7-7d63-a1ee-000000000825',
      operationKind: 'tool_call',
      bucket: 'tool',
      toolCallId: '018f1d8a-54d7-7d63-a1ee-000000000826',
      operationFingerprint: fingerprint,
      operationFingerprintVersion: 'canonical_tool_input_v1',
      phase: 'agent_loop',
      round: 3,
      name: 'folder_read',
    });

    expect(repeated.loopGuardSignal).toBeUndefined();
    expect(repeated.guardState.detections).toBe(0);
  });

  it('rejects an incompatible repeated grant and a bucket outside its phase', async () => {
    const { grant } = await service.requestProgressGrant(
      EXECUTION_ID,
      grantRequest(),
    );
    await expect(
      service.requestProgressGrant(EXECUTION_ID, {
        ...grantRequest(),
        requestedPolicy: {
          ...grantRequest().requestedPolicy,
          toolCalls: 5,
        },
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      service.reserveOperationBudget(EXECUTION_ID, {
        executionId: EXECUTION_ID,
        loopId: EXECUTION_ID,
        grantId: grant.grantId,
        operationId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca706',
        operationKind: 'inference',
        bucket: 'closing',
        phase: 'agent_loop',
        round: 1,
        name: 'chat_with_tools',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.reserveOperationBudget(EXECUTION_ID, {
        executionId: EXECUTION_ID,
        loopId: EXECUTION_ID,
        grantId: grant.grantId,
        operationId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca725',
        operationKind: 'tool_call',
        bucket: 'tool',
        toolCallId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca726',
        phase: 'forced_finalization',
        round: 1,
        name: 'folder_read',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.reserveOperationBudget(EXECUTION_ID, {
        executionId: EXECUTION_ID,
        loopId: EXECUTION_ID,
        grantId: grant.grantId,
        operationId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca727',
        operationKind: 'inference',
        bucket: 'normal',
        toolCallId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca728',
        phase: 'agent_loop',
        round: 1,
        name: 'chat_with_tools',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects budget decisions submitted through the models event channel', () => {
    const incoming = {
      eventId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca729',
      rootExecutionId: EXECUTION_ID,
      executionId: EXECUTION_ID,
      eventType: 'progress.reported',
      payloadSchema: 'progress.reported/1',
      producer: {
        component: 'documents-models',
        instanceId: 'worker-test',
      },
      producerSequence: 1,
      occurredAt: '2026-08-20T10:00:00Z',
      payload: { message: 'spoofed grant', kind: 'budget_grant' },
      artifactRefs: [],
      security: { dataClassification: 'workspace' },
    };

    expect(() =>
      (executionService as any).validateIncomingEvent(execution, incoming),
    ).toThrow('Budget decisions can only be emitted by documents-backend');
    expect(() =>
      (executionService as any).validateIncomingEvent(execution, {
        ...incoming,
        eventId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca730',
        payload: { message: 'spoofed reservation', kind: 'budget_reservation' },
      }),
    ).toThrow('Budget decisions can only be emitted by documents-backend');
    expect(() =>
      (executionService as any).validateIncomingEvent(execution, {
        ...incoming,
        eventId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca731',
        payload: {
          message: 'spoofed soft limit',
          kind: 'budget_soft_limit_reached',
        },
      }),
    ).toThrow('Budget decisions can only be emitted by documents-backend');
  });

  it('does not re-grant a reservation after its operation consumed it', async () => {
    const { grant } = await service.requestProgressGrant(
      EXECUTION_ID,
      grantRequest(),
    );
    const operationId = '018f1d8a-54d7-7d63-a1ee-5e9a6adca707';
    const request = {
      executionId: EXECUTION_ID,
      loopId: EXECUTION_ID,
      grantId: grant.grantId,
      operationId,
      operationKind: 'inference' as const,
      bucket: 'normal' as const,
      phase: 'agent_loop',
      round: 1,
      name: 'chat_with_tools',
    };
    await service.reserveOperationBudget(EXECUTION_ID, request);
    rows.push({
      envelope: {
        sequence: 3,
        eventType: 'operation.started',
        operationId,
        attemptId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca708',
        payload: { operationKind: 'inference' },
      },
    });

    await expect(
      service.reserveOperationBudget(EXECUTION_ID, request),
    ).resolves.toMatchObject({
      granted: false,
      reservation: {
        status: 'consumed',
        reason: 'budget_reservation_consumed',
      },
    });
  });

  it('requires a reservation for governed chat phases even if loopKind is omitted', async () => {
    expect(() =>
      validateBudgetStart({
        eventType: 'operation.started',
        operationId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca709',
        payload: {
          operationKind: 'inference',
          phase: 'direct_response',
          name: 'direct_response',
          round: 1,
        },
      }),
    ).toThrow(ConflictException);

    expect(() =>
      validateBudgetStart({
        eventType: 'operation.started',
        operationId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca712',
        payload: {
          operationKind: 'inference',
          loopKind: 'synchronous_subagent',
          phase: 'memory_extraction',
          name: 'memory_extraction',
          round: 1,
        },
      }),
    ).not.toThrow();
  });

  it('validates the complete reservation identity before consuming it', async () => {
    const { grant } = await service.requestProgressGrant(
      EXECUTION_ID,
      grantRequest(),
    );
    const operationId = '018f1d8a-54d7-7d63-a1ee-5e9a6adca711';
    const decision = await service.reserveOperationBudget(EXECUTION_ID, {
      executionId: EXECUTION_ID,
      loopId: EXECUTION_ID,
      grantId: grant.grantId,
      operationId,
      operationKind: 'inference',
      bucket: 'normal',
      phase: 'direct_response',
      round: 1,
      name: 'direct_response',
    });
    const payload = {
      operationKind: 'inference',
      loopId: EXECUTION_ID,
      loopKind: 'top_level',
      phase: 'direct_response',
      name: 'direct_response',
      round: 1,
      budgetGrantId: grant.grantId,
      budgetReservationId: decision.reservation.reservationId,
      budgetBucket: 'normal',
    };
    expect(() =>
      validateBudgetStart({
        eventType: 'operation.started',
        operationId,
        payload,
      }),
    ).not.toThrow();
    expect(() =>
      validateBudgetStart({
        eventType: 'operation.started',
        operationId,
        payload: { ...payload, name: 'different_operation' },
      }),
    ).toThrow(ConflictException);
  });

  it('rejects budget work for a terminal execution', async () => {
    execution.status = ExecutionStatus.COMPLETED;
    await expect(
      service.requestProgressGrant(EXECUTION_ID, grantRequest()),
    ).rejects.toBeInstanceOf(ConflictException);
    execution.status = ExecutionStatus.RUNNING;
    expect(() =>
      validateBudgetStart({
        eventType: 'operation.started',
        operationId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca710',
        payload: {
          operationKind: 'inference',
          phase: 'direct_response',
          name: 'direct_response',
          round: 1,
        },
      }),
    ).toThrow(ConflictException);
  });
});

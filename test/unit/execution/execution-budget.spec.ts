import { BadRequestException, ConflictException } from '@nestjs/common';
import { ExecutionEntity } from '../../../src/execution/execution.entity';
import { ExecutionEventEntity } from '../../../src/execution/execution-event.entity';
import {
  assertOperationBudgetProjection,
  governedBudgetStart,
} from '../../../src/execution/inference-budget-policy';
import {
  ProgressEvent,
  projectExecutionProgress,
} from '../../../src/execution/execution-progress';
import { ExecutionService } from '../../../src/execution/execution.service';
import { ExecutionStatus } from '../../../src/execution/execution-status.enum';

const EXECUTION_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca701';
const TURN_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca702';
const ATTEMPT_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca703';

describe('ExecutionService operation budget', () => {
  let service: ExecutionService;
  let execution: Record<string, any>;
  let rows: any[];

  const validateBudgetStart = (event: Record<string, unknown>) => {
    const identity = governedBudgetStart(
      execution as ExecutionEntity,
      event,
    );
    if (!identity) return;
    const progress = projectExecutionProgress(
      rows.map((row) => row.envelope as ProgressEvent),
    );
    assertOperationBudgetProjection(identity, progress.ledger.operationBudget);
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
    const manager = {
      getRepository: jest.fn((entity) =>
        entity === ExecutionEntity
          ? executionRepo
          : entity === ExecutionEventEntity
            ? eventRepo
            : undefined,
      ),
      save: jest.fn(async (value) => {
        if (value?.eventId) rows.push(value);
        return value;
      }),
    };
    service = Object.create(ExecutionService.prototype);
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
    executionAttemptId: ATTEMPT_ID,
    requestedPolicy: {
      normal: 3,
      repair: 1,
      closing: 1,
      maxTokensPerInference: 1000,
      toolCalls: 6,
    },
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
      executionAttemptId: ATTEMPT_ID,
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
      executionAttemptId: ATTEMPT_ID,
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
        executionAttemptId: ATTEMPT_ID,
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
        executionAttemptId: ATTEMPT_ID,
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
        executionAttemptId: ATTEMPT_ID,
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
        executionAttemptId: ATTEMPT_ID,
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
      (service as any).validateIncomingEvent(execution, incoming),
    ).toThrow('Budget decisions can only be emitted by documents-backend');
    expect(() =>
      (service as any).validateIncomingEvent(execution, {
        ...incoming,
        eventId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca730',
        payload: { message: 'spoofed reservation', kind: 'budget_reservation' },
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
      executionAttemptId: ATTEMPT_ID,
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
      executionAttemptId: ATTEMPT_ID,
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
      executionAttemptId: ATTEMPT_ID,
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

  it('rejects a stale execution attempt before granting or reserving', async () => {
    const stale = {
      ...grantRequest(),
      executionAttemptId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca799',
    };

    await expect(
      service.requestProgressGrant(EXECUTION_ID, stale),
    ).rejects.toBeInstanceOf(ConflictException);

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
          executionAttemptId: stale.executionAttemptId,
        },
      }),
    ).toThrow(ConflictException);
  });
});

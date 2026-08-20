import { BadRequestException, ConflictException } from '@nestjs/common';
import { ExecutionEntity } from '../../../src/execution/execution.entity';
import { ExecutionEventEntity } from '../../../src/execution/execution-event.entity';
import {
  assertInferenceBudgetProjection,
  governedInferenceStart,
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

describe('ExecutionService inference budget', () => {
  let service: ExecutionService;
  let execution: Record<string, any>;
  let rows: any[];

  const validateInferenceStart = (event: Record<string, unknown>) => {
    const identity = governedInferenceStart(
      execution as ExecutionEntity,
      event,
    );
    if (!identity) return;
    const progress = projectExecutionProgress(
      rows.map((row) => row.envelope as ProgressEvent),
    );
    assertInferenceBudgetProjection(identity, progress.ledger.inferenceBudget);
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
      get: jest.fn((name: string) =>
        name === 'PROGRESS_CHAT_MAX_NORMAL_INFERENCES' ? '1' : undefined,
      ),
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
    expect(repeatedGrant.grant.grantId).toBe(firstGrant.grant.grantId);

    const baseReservation = {
      executionId: EXECUTION_ID,
      loopId: EXECUTION_ID,
      grantId: firstGrant.grant.grantId,
      bucket: 'normal' as const,
      phase: 'agent_loop',
      round: 1,
      name: 'chat_with_tools',
      executionAttemptId: ATTEMPT_ID,
    };
    const first = await service.reserveInferenceBudget(EXECUTION_ID, {
      ...baseReservation,
      operationId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca704',
    });
    const denied = await service.reserveInferenceBudget(EXECUTION_ID, {
      ...baseReservation,
      operationId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca705',
    });

    expect(first.granted).toBe(true);
    expect(denied.granted).toBe(false);
    expect(denied.reservation.reason).toBe('budget_hard_limit_reached');
    expect(
      execution.progressLedger.inferenceBudget.grants[firstGrant.grant.grantId]
        .usage.normal,
    ).toEqual({
      granted: 1,
      reserved: 1,
      consumed: 0,
      available: 0,
    });

    const repeatedReservation = await service.reserveInferenceBudget(
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
          repair: 0,
        },
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      service.reserveInferenceBudget(EXECUTION_ID, {
        executionId: EXECUTION_ID,
        loopId: EXECUTION_ID,
        grantId: grant.grantId,
        operationId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca706',
        bucket: 'closing',
        phase: 'agent_loop',
        round: 1,
        name: 'chat_with_tools',
        executionAttemptId: ATTEMPT_ID,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
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
      bucket: 'normal' as const,
      phase: 'agent_loop',
      round: 1,
      name: 'chat_with_tools',
      executionAttemptId: ATTEMPT_ID,
    };
    await service.reserveInferenceBudget(EXECUTION_ID, request);
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
      service.reserveInferenceBudget(EXECUTION_ID, request),
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
      validateInferenceStart({
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
      validateInferenceStart({
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
    const decision = await service.reserveInferenceBudget(EXECUTION_ID, {
      executionId: EXECUTION_ID,
      loopId: EXECUTION_ID,
      grantId: grant.grantId,
      operationId,
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
      validateInferenceStart({
        eventType: 'operation.started',
        operationId,
        payload,
      }),
    ).not.toThrow();
    expect(() =>
      validateInferenceStart({
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
      validateInferenceStart({
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

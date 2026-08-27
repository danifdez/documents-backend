import { PERMISSIONS_KEY } from '../../../src/auth/decorators/permissions.decorator';
import { Permission } from '../../../src/auth/permission.enum';
import { ExecutionOperationsController } from '../../../src/execution-operations/execution-operations.controller';
import { ExecutionOperationsService } from '../../../src/execution-operations/execution-operations.service';

const NOW = new Date('2026-08-27T10:00:00.000Z');

describe('ExecutionOperationsService', () => {
  let query: jest.Mock;
  let config: { get: jest.Mock };
  let coordinator: Record<string, jest.Mock>;
  let attempts: Record<string, jest.Mock>;
  let executions: Record<string, jest.Mock>;
  let workers: Record<string, jest.Mock>;
  let service: ExecutionOperationsService;

  beforeEach(() => {
    query = jest
      .fn()
      .mockResolvedValueOnce([
        {
          ready: '3',
          running: '2',
          blocked: '1',
          overdueDeadlines: '0',
          oldestReadyMs: '90000.4',
        },
      ])
      .mockResolvedValueOnce([
        {
          leased: '2',
          running: '1',
          resultReceived: '1',
          expiredActiveLeases: '0',
          oldestReceivedMs: '1000',
        },
      ])
      .mockResolvedValueOnce([
        {
          online: '2',
          offline: '1',
          revoked: '1',
          maximumConcurrency: '5',
          activeAssignments: '3',
        },
      ])
      .mockResolvedValueOnce([
        {
          pending: '1',
          publishing: '0',
          expiredPublishingLeases: '0',
          oldestUnpublishedMs: '500',
        },
      ])
      .mockResolvedValueOnce([
        {
          staleFinalizations: '0',
          staleEffects: '0',
          inconclusiveEffects: '0',
          expiredConfirmations: '0',
        },
      ])
      .mockResolvedValueOnce([
        {
          active: '4',
          unavailable: '2',
          expiredButActive: '0',
          activeBytes: '2048',
          largestActiveBytes: '1024',
        },
      ]);
    config = { get: jest.fn().mockReturnValue(undefined) };
    coordinator = {
      recoverStaleToolEffects: jest.fn().mockResolvedValue(1),
      expireConfirmations: jest.fn().mockResolvedValue(2),
      recoverStaleFinalizations: jest.fn().mockResolvedValue(3),
      acceptResults: jest.fn().mockResolvedValue(4),
      finalizeReady: jest.fn().mockResolvedValue(5),
      publishNotifications: jest.fn().mockResolvedValue(6),
    };
    attempts = { expireStaleAttempts: jest.fn().mockResolvedValue(7) };
    executions = { purgeExpiredArtifacts: jest.fn().mockResolvedValue(8) };
    workers = {
      markStaleOffline: jest.fn().mockResolvedValue(9),
      registrations: jest.fn().mockResolvedValue([]),
    };
    service = new ExecutionOperationsService(
      { query } as any,
      config as any,
      coordinator as any,
      attempts as any,
      executions as any,
      workers as any,
    );
  });

  it('projects queue, capacity, recovery and SLO health without changing state', async () => {
    const result = await service.snapshot(NOW);

    expect(query).toHaveBeenCalledTimes(6);
    expect(result).toMatchObject({
      schemaVersion: 'execution-operations/1',
      generatedAt: NOW.toISOString(),
      state: 'degraded',
      queue: { ready: 3, oldestReadyMs: 90000 },
      workers: {
        maximumConcurrency: 5,
        activeAssignments: 3,
        availableConcurrency: 2,
      },
      registrations: [],
      recovery: { inconclusiveEffects: 0 },
      artifacts: { activeBytes: 2048, largestActiveBytes: 1024 },
      slo: {
        readyQueue: {
          observedMs: 90000,
          thresholdMs: 60000,
          status: 'degraded',
        },
      },
    });
  });

  it('uses positive configured SLO thresholds and ignores invalid values', async () => {
    config.get.mockImplementation((key: string) =>
      key === 'EXECUTION_SLO_READY_MS' ? '120000' : '-1',
    );

    const result = await service.snapshot(NOW);

    expect(result.slo.readyQueue).toEqual({
      observedMs: 90000,
      thresholdMs: 120000,
      status: 'ok',
    });
    expect(result.slo.publication.thresholdMs).toBe(30000);
    expect(result.state).toBe('operational');
  });

  it('runs bounded recovery in the safe order before returning fresh state', async () => {
    const result = await service.reconcile(10);

    const ordered = [
      coordinator.recoverStaleToolEffects,
      attempts.expireStaleAttempts,
      coordinator.expireConfirmations,
      coordinator.recoverStaleFinalizations,
      coordinator.acceptResults,
      coordinator.finalizeReady,
      coordinator.publishNotifications,
      workers.markStaleOffline,
      executions.purgeExpiredArtifacts,
    ].map((mock) => mock.mock.invocationCallOrder[0]);
    expect(ordered).toEqual([...ordered].sort((left, right) => left - right));
    expect(coordinator.recoverStaleToolEffects).toHaveBeenCalledWith(10);
    expect(attempts.expireStaleAttempts).toHaveBeenCalledWith(
      expect.any(Date),
      10,
    );
    expect(executions.purgeExpiredArtifacts).toHaveBeenCalledWith(10);
    expect(result).toMatchObject({
      schemaVersion: 'execution-reconciliation/1',
      limit: 10,
      recoveredEffects: 1,
      expiredAttempts: 7,
      expiredConfirmations: 2,
      recoveredFinalizations: 3,
      acceptedResults: 4,
      finalizedExecutions: 5,
      publishedNotifications: 6,
      offlinedWorkers: 9,
      expiredArtifacts: 8,
      stateAfter: { schemaVersion: 'execution-operations/1' },
    });
  });
});

describe('ExecutionOperationsController', () => {
  it('requires administrative user-management permission', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, ExecutionOperationsController),
    ).toEqual([Permission.USER_MANAGEMENT]);
  });
});

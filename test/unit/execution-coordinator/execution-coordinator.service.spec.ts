import { ExecutionCoordinatorService } from '../../../src/execution-coordinator/execution-coordinator.service';
import { ExecutionEntity } from '../../../src/execution/execution.entity';
import { ExecutionStatus } from '../../../src/execution/execution-status.enum';

const EXECUTION_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca701';

function execution(overrides: Partial<ExecutionEntity> = {}): ExecutionEntity {
  return {
    executionId: EXECUTION_ID,
    taskType: 'detect-language',
    status: ExecutionStatus.RUNNING,
    phase: 'domain_finalization',
    ...overrides,
  } as ExecutionEntity;
}

describe('ExecutionCoordinatorService', () => {
  let service: ExecutionCoordinatorService;
  let executionService: Record<string, jest.Mock>;
  let executionAttemptService: Record<string, jest.Mock>;
  let processorFactory: Record<string, jest.Mock>;
  let outboxService: Record<string, jest.Mock>;
  let toolRuntime: Record<string, jest.Mock>;
  let agentLoop: Record<string, jest.Mock>;
  let confirmations: Record<string, jest.Mock>;

  beforeEach(() => {
    executionService = {
      claimReadyForFinalization: jest.fn(),
      findOne: jest.fn(),
      markAsCompleted: jest.fn(),
      markAsFailed: jest.fn(),
      recoverStaleFinalizations: jest.fn(),
      finalizePendingTerminals: jest.fn().mockResolvedValue(0),
    };
    executionAttemptService = {
      processReceivedResults: jest.fn(),
    };
    processorFactory = {
      getProcessor: jest.fn(),
    };
    outboxService = {
      publishPending: jest.fn(),
    };
    toolRuntime = {
      executeReady: jest.fn(),
    };
    agentLoop = {
      prepareReadyInferences: jest.fn(),
      materializeAcceptedToolRequests: jest.fn().mockResolvedValue(0),
      materializeReadyToolContinuations: jest.fn().mockResolvedValue(0),
      releaseTerminalDelegations: jest.fn().mockResolvedValue(0),
    };
    confirmations = {
      expirePending: jest.fn(),
    };
    service = new ExecutionCoordinatorService(
      executionService as any,
      executionAttemptService as any,
      processorFactory as any,
      outboxService as any,
      toolRuntime as any,
      agentLoop as any,
      confirmations as any,
    );
  });

  it('prepares governed inference work before workers can claim it', async () => {
    agentLoop.prepareReadyInferences.mockResolvedValue(2);

    await expect(service.prepareAgentWork(2)).resolves.toBe(2);
    expect(agentLoop.prepareReadyInferences).toHaveBeenCalledWith(2);
  });

  it('executes ready local tools through the canonical runtime', async () => {
    toolRuntime.executeReady.mockResolvedValue(2);

    await expect(service.executeReadyTools(2)).resolves.toBe(2);
    expect(toolRuntime.executeReady).toHaveBeenCalledWith(2);
  });

  it('expires durable confirmations through the coordinator', async () => {
    confirmations.expirePending.mockResolvedValue(2);

    await expect(service.expireConfirmations(2)).resolves.toBe(2);
    expect(confirmations.expirePending).toHaveBeenCalledWith(2);
  });

  it('accepts durable result receipts through the attempt service', async () => {
    executionAttemptService.processReceivedResults.mockResolvedValue(3);

    await expect(service.acceptResults(3)).resolves.toBe(3);
    expect(executionAttemptService.processReceivedResults).toHaveBeenCalledWith(
      3,
    );
    expect(agentLoop.materializeAcceptedToolRequests).toHaveBeenCalledWith(3);
    expect(agentLoop.materializeReadyToolContinuations).toHaveBeenCalledWith(3);
    expect(executionService.finalizePendingTerminals).toHaveBeenCalledWith(3);
    expect(agentLoop.releaseTerminalDelegations).toHaveBeenCalledWith(3);
  });

  it('runs a claimed domain finalizer and completes the execution', async () => {
    const claimed = execution();
    executionService.claimReadyForFinalization
      .mockResolvedValueOnce(claimed)
      .mockResolvedValueOnce(null);
    executionService.findOne.mockResolvedValue(claimed);
    const processor = {
      process: jest.fn().mockResolvedValue({ success: true }),
    };
    processorFactory.getProcessor.mockReturnValue(processor);

    await expect(service.finalizeReady()).resolves.toBe(1);
    expect(processor.process).toHaveBeenCalledWith(claimed);
    expect(executionService.markAsCompleted).toHaveBeenCalledWith(
      EXECUTION_ID,
      { publication: undefined },
    );
    expect(executionService.markAsFailed).not.toHaveBeenCalled();
  });

  it('fails explicitly when the task type has no finalizer', async () => {
    executionService.claimReadyForFinalization
      .mockResolvedValueOnce(execution({ taskType: 'unknown' }))
      .mockResolvedValueOnce(null);
    processorFactory.getProcessor.mockReturnValue(undefined);

    await expect(service.finalizeReady()).resolves.toBe(1);
    expect(executionService.markAsFailed).toHaveBeenCalledWith(
      EXECUTION_ID,
      'No execution finalizer registered for task type: unknown',
    );
    expect(executionService.markAsCompleted).not.toHaveBeenCalled();
  });

  it('fails when the domain finalizer rejects the result', async () => {
    executionService.claimReadyForFinalization
      .mockResolvedValueOnce(execution())
      .mockResolvedValueOnce(null);
    processorFactory.getProcessor.mockReturnValue({
      process: jest.fn().mockResolvedValue({
        success: false,
        message: 'Invalid language result',
      }),
    });

    await expect(service.finalizeReady()).resolves.toBe(1);
    expect(executionService.markAsFailed).toHaveBeenCalledWith(
      EXECUTION_ID,
      'Invalid language result',
      { publication: undefined },
    );
    expect(executionService.markAsCompleted).not.toHaveBeenCalled();
  });

  it('keeps a failed execution terminal after domain reconciliation', async () => {
    const claimed = execution({
      phase: 'domain_failure_finalization',
      error: { code: 'MODEL_FAILED', message: 'Model failed' },
    });
    executionService.claimReadyForFinalization
      .mockResolvedValueOnce(claimed)
      .mockResolvedValueOnce(null);
    processorFactory.getProcessor.mockReturnValue({
      process: jest.fn().mockResolvedValue({
        success: true,
        publication: { socketEvent: 'notification', payload: {} },
      }),
    });

    await expect(service.finalizeReady()).resolves.toBe(1);
    expect(executionService.markAsFailed).toHaveBeenCalledWith(
      EXECUTION_ID,
      'Model failed',
      {
        publication: { socketEvent: 'notification', payload: {} },
      },
    );
    expect(executionService.markAsCompleted).not.toHaveBeenCalled();
  });

  it('publishes durable terminal notifications through the outbox', async () => {
    outboxService.publishPending.mockResolvedValue(2);

    await expect(service.publishNotifications(2)).resolves.toBe(2);
    expect(outboxService.publishPending).toHaveBeenCalledWith(2);
  });

  it('does not overwrite a terminal state set by the finalizer', async () => {
    executionService.claimReadyForFinalization
      .mockResolvedValueOnce(execution())
      .mockResolvedValueOnce(null);
    processorFactory.getProcessor.mockReturnValue({
      process: jest.fn().mockResolvedValue({ success: true }),
    });
    executionService.findOne.mockResolvedValue(
      execution({ status: ExecutionStatus.CANCELLED, phase: null }),
    );

    await expect(service.finalizeReady()).resolves.toBe(1);
    expect(executionService.markAsCompleted).not.toHaveBeenCalled();
  });

  it('recovers finalizations older than the requested threshold', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-24T10:05:00.000Z'));
    executionService.recoverStaleFinalizations.mockResolvedValue(2);

    await expect(service.recoverStaleFinalizations(300_000)).resolves.toBe(2);
    expect(executionService.recoverStaleFinalizations).toHaveBeenCalledWith(
      new Date('2026-08-24T10:00:00.000Z'),
    );
    jest.useRealTimers();
  });
});

import { ExecutionService } from '../../../src/execution/execution.service';
import { ExecutionStatus } from '../../../src/execution/execution-status.enum';
import { ExecutionEntity } from '../../../src/execution/execution.entity';
import { ExecutionEventEntity } from '../../../src/execution/execution-event.entity';
const EXECUTION_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca701';

describe('ExecutionService queue state', () => {
  let service: ExecutionService;
  let executionRepo: Record<string, jest.Mock>;
  let eventRepo: Record<string, jest.Mock>;
  let manager: Record<string, jest.Mock>;

  beforeEach(() => {
    executionRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      findOneBy: jest.fn(),
      save: jest.fn(),
    };
    eventRepo = {
      create: jest.fn((value) => value),
      findOne: jest.fn().mockResolvedValue({ producerSequence: '3' }),
      save: jest.fn(async (value) => value),
    };
    manager = {
      getRepository: jest.fn((entity) =>
        entity === ExecutionEntity
          ? executionRepo
          : entity === ExecutionEventEntity
            ? eventRepo
            : undefined,
      ),
      query: jest.fn(),
      save: jest.fn(async (value) => value),
    };
    service = Object.create(ExecutionService.prototype);
    (service as any).executionRepo = executionRepo;
    (service as any).dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
    };
  });

  it('finds an execution by its UUID', async () => {
    const execution = { executionId: EXECUTION_ID };
    executionRepo.findOneBy.mockResolvedValue(execution);

    await expect(service.findOne(EXECUTION_ID)).resolves.toBe(execution);
    expect(executionRepo.findOneBy).toHaveBeenCalledWith({
      executionId: EXECUTION_ID,
    });
  });

  it('claims one finalization atomically', async () => {
    const execution = {
      executionId: EXECUTION_ID,
      status: ExecutionStatus.RUNNING,
      phase: 'backend_finalization',
    };
    manager.query.mockResolvedValue([{ execution_id: EXECUTION_ID }]);
    executionRepo.findOneBy.mockResolvedValue(execution);
    executionRepo.save.mockImplementation(async (value) => value);

    await expect(service.claimReadyForFinalization()).resolves.toEqual(
      expect.objectContaining({ phase: 'domain_finalization' }),
    );
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE SKIP LOCKED'),
    );
    expect(executionRepo.save).toHaveBeenCalledWith(execution);
  });

  it('returns null when there is no finalization to claim', async () => {
    manager.query.mockResolvedValue([]);

    await expect(service.claimReadyForFinalization()).resolves.toBeNull();
    expect(executionRepo.findOneBy).not.toHaveBeenCalled();
  });

  it('makes abandoned finalizations claimable again', async () => {
    const staleBefore = new Date('2026-08-24T10:00:00.000Z');
    manager.query.mockResolvedValue([
      { execution_id: EXECUTION_ID },
      { execution_id: '018f1d8a-54d7-7d63-a1ee-5e9a6adca703' },
    ]);

    await expect(service.recoverStaleFinalizations(staleBefore)).resolves.toBe(
      2,
    );
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining(`SET "phase" = 'backend_finalization'`),
      [staleBefore],
    );
  });

  it('marks terminal state and completion time on the same execution', async () => {
    const execution = {
      executionId: EXECUTION_ID,
      rootExecutionId: EXECUTION_ID,
      turnId: null,
      status: ExecutionStatus.RUNNING,
      phase: 'backend_finalization',
      completedAt: null,
      result: { value: 42 },
      error: null,
      lastSequence: '3',
      lastEventId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca702',
    };
    executionRepo.findOne.mockResolvedValue(execution);
    executionRepo.save.mockImplementation(async (value) => value);

    const result = await service.updateStatus(
      EXECUTION_ID,
      ExecutionStatus.COMPLETED,
    );

    expect(result?.status).toBe(ExecutionStatus.COMPLETED);
    expect(result?.phase).toBeNull();
    expect(result?.completedAt).toBeInstanceOf(Date);
    expect(result?.completionReason).toBe('backend_finalized');
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'execution.state_changed',
        executionId: EXECUTION_ID,
      }),
    );
  });

  it('returns null when the execution does not exist', async () => {
    executionRepo.findOne.mockResolvedValue(null);

    await expect(
      service.updateStatus(EXECUTION_ID, ExecutionStatus.FAILED),
    ).resolves.toBeNull();
  });
});

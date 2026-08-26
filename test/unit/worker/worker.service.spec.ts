import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WorkerService } from '../../../src/worker/worker.service';
import { WorkerEntity } from '../../../src/worker/worker.entity';
import { ExecutionStepAttemptEntity } from '../../../src/execution/execution-step-attempt.entity';
import { createMockRepository, MockRepository } from '../../test-utils';
import { buildWorker } from '../../factories';
import { ExecutionContractValidator } from '../../../src/execution/execution-contract-validator';
import { WorkerKind } from '../../../src/worker/worker-kind.enum';
import { ExecutionStepKind } from '../../../src/execution/execution-step-kind.enum';

describe('WorkerService', () => {
  let service: WorkerService;
  let repo: MockRepository<WorkerEntity>;
  let attemptRepo: MockRepository<ExecutionStepAttemptEntity>;

  beforeEach(async () => {
    repo = createMockRepository();
    attemptRepo = createMockRepository();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkerService,
        { provide: getRepositoryToken(WorkerEntity), useValue: repo },
        {
          provide: getRepositoryToken(ExecutionStepAttemptEntity),
          useValue: attemptRepo,
        },
      ],
    }).compile();
    service = module.get(WorkerService);
  });

  it('should find all workers', async () => {
    repo.find.mockResolvedValue([buildWorker()]);
    expect(await service.findAll()).toHaveLength(1);
  });

  it('should find online workers', async () => {
    repo.find.mockResolvedValue([buildWorker()]);
    expect(await service.findOnline()).toHaveLength(1);
  });

  it('should find by id', async () => {
    repo.findOneBy.mockResolvedValue(buildWorker());
    expect(await service.findById('test-uuid')).toBeDefined();
  });

  it('enrolls a browser with server-owned capabilities', async () => {
    const queryBuilder = repo.createQueryBuilder!() as any;
    queryBuilder.getOne.mockResolvedValue(null);
    repo.create.mockImplementation((worker) => worker);
    repo.save.mockImplementation((worker) => Promise.resolve(worker));

    const registration = await service.enrollBrowser(
      '018f1d8a-54d7-7d63-a1ee-5e9a6adca704',
      'IA Browser',
      '7',
      { version: 'test' },
    );

    expect(registration.worker).toMatchObject({
      workerKind: WorkerKind.BROWSER,
      ownerPrincipal: '7',
      capabilities: [
        'tool.browser.read_current_page/1',
        'tool.browser.navigate/1',
        'tool.browser.go_back/1',
        'tool.browser.click/1',
        'tool.browser.type_text/1',
        'tool.browser.select_option/1',
      ],
      stepKinds: [ExecutionStepKind.TOOL],
      maximumConcurrency: 1,
      status: 'online',
      revokedAt: null,
    });
    expect(registration.worker.credentialHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(registration.credential).not.toContain('sha256:');
  });

  it('does not register Models as a tool worker', async () => {
    await expect(
      service.registerModels(
        '018f1d8a-54d7-7d63-a1ee-5e9a6adca704',
        'Models',
        ['tool.browser.read_current_page/1'],
        [ExecutionStepKind.TOOL],
        1,
        {},
      ),
    ).rejects.toThrow('models_tool_steps_not_allowed');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('does not let a Models heartbeat escalate into tool work', async () => {
    repo.update = jest.fn();

    await expect(
      service.heartbeatModels(
        '018f1d8a-54d7-7d63-a1ee-5e9a6adca704',
        ['tool.browser.read_current_page/1'],
        [ExecutionStepKind.TOOL],
        1,
        {},
      ),
    ).rejects.toThrow('models_tool_steps_not_allowed');
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('updates only a live Models identity during heartbeat', async () => {
    repo.update = jest.fn().mockResolvedValue({ affected: 1 });

    await service.heartbeatModels(
      '018f1d8a-54d7-7d63-a1ee-5e9a6adca704',
      ['detect-language'],
      [ExecutionStepKind.SERVICE],
      1,
      { version: 'test' },
    );

    expect(repo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '018f1d8a-54d7-7d63-a1ee-5e9a6adca704',
        workerKind: WorkerKind.MODELS,
        revokedAt: expect.anything(),
      }),
      expect.objectContaining({
        capabilities: ['detect-language'],
        stepKinds: [ExecutionStepKind.SERVICE],
        maximumConcurrency: 1,
        status: 'online',
      }),
    );
  });

  it('does not revive a Models identity revoked after authentication', async () => {
    repo.update = jest.fn().mockResolvedValue({ affected: 0 });

    await expect(
      service.heartbeatModels(
        '018f1d8a-54d7-7d63-a1ee-5e9a6adca704',
        ['detect-language'],
        [ExecutionStepKind.SERVICE],
        1,
        {},
      ),
    ).rejects.toThrow('worker_not_available');
  });

  it('revokes only a browser owned by the current principal', async () => {
    const queryBuilder = repo.createQueryBuilder!() as any;
    const worker = buildWorker({
      workerKind: WorkerKind.BROWSER,
      ownerPrincipal: '7',
      credentialHash: `sha256:${'a'.repeat(64)}`,
    });
    queryBuilder.getOne.mockResolvedValue(worker);
    repo.save.mockImplementation((saved) => Promise.resolve(saved));

    await service.revokeBrowser(worker.id, '7');

    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'revoked',
        credentialHash: null,
        revokedAt: expect.any(Date),
      }),
    );
  });

  it('derives active assignments and available concurrency', async () => {
    const worker = buildWorker({ maximumConcurrency: 2 });
    repo.find.mockResolvedValue([worker]);
    attemptRepo.find.mockResolvedValue([
      {
        attemptId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca704',
        claimedBy: worker.id,
      } as ExecutionStepAttemptEntity,
    ]);

    const registrations = await service.registrations();
    expect(registrations).toEqual([
      expect.objectContaining({
        schemaVersion: 'worker-registration/1',
        workerId: worker.id,
        concurrency: { maximum: 2, available: 1 },
        activeAssignments: ['018f1d8a-54d7-7d63-a1ee-5e9a6adca704'],
        loadSummary: { state: 'available', active: 1 },
      }),
    ]);
    expect(() =>
      new ExecutionContractValidator().assertWorkerRegistration(
        registrations[0] as unknown as Record<string, unknown>,
      ),
    ).not.toThrow();
  });
});

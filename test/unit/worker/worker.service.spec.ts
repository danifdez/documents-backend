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
import { WorkerCredentialEventEntity } from '../../../src/worker/worker-credential-event.entity';
import { DataSource } from 'typeorm';
import { WorkerController } from '../../../src/worker/worker.controller';
import { PERMISSIONS_KEY } from '../../../src/auth/decorators/permissions.decorator';
import { Permission } from '../../../src/auth/permission.enum';

describe('WorkerService', () => {
  let service: WorkerService;
  let repo: MockRepository<WorkerEntity>;
  let attemptRepo: MockRepository<ExecutionStepAttemptEntity>;
  let credentialEventRepo: MockRepository<WorkerCredentialEventEntity>;

  beforeEach(async () => {
    repo = createMockRepository();
    attemptRepo = createMockRepository();
    credentialEventRepo = createMockRepository();
    credentialEventRepo.create!.mockImplementation((event) => event);
    credentialEventRepo.save!.mockImplementation((event) =>
      Promise.resolve(event),
    );
    const dataSource = {
      transaction: jest.fn((work) =>
        work({
          query: jest.fn().mockResolvedValue([]),
          getRepository: (entity: unknown) =>
            entity === WorkerEntity ? repo : credentialEventRepo,
        }),
      ),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkerService,
        { provide: getRepositoryToken(WorkerEntity), useValue: repo },
        {
          provide: getRepositoryToken(ExecutionStepAttemptEntity),
          useValue: attemptRepo,
        },
        {
          provide: getRepositoryToken(WorkerCredentialEventEntity),
          useValue: credentialEventRepo,
        },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();
    service = module.get(WorkerService);
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
    expect(credentialEventRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        workerId: registration.worker.id,
        workerKind: WorkerKind.BROWSER,
        action: 'issued',
        actorType: 'user',
        actorPrincipal: '7',
      }),
    );
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
    expect(credentialEventRepo.save).not.toHaveBeenCalled();
  });

  it('does not reactivate a revoked browser identity during enrollment', async () => {
    const queryBuilder = repo.createQueryBuilder!() as any;
    queryBuilder.getOne.mockResolvedValue(
      buildWorker({
        workerKind: WorkerKind.BROWSER,
        ownerPrincipal: '7',
        status: 'revoked',
        revokedAt: new Date(),
        credentialHash: null,
      }),
    );

    await expect(
      service.enrollBrowser(
        '018f1d8a-54d7-7d63-a1ee-5e9a6adca704',
        'IA Browser',
        '7',
        {},
      ),
    ).rejects.toThrow('worker_identity_revoked');
    expect(repo.save).not.toHaveBeenCalled();
    expect(credentialEventRepo.save).not.toHaveBeenCalled();
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

  it('marks stale workers offline with an atomic guarded update', async () => {
    repo.update = jest.fn().mockResolvedValue({ affected: 2 });

    await expect(service.markStaleOffline(60)).resolves.toBe(2);

    expect(repo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'online',
        revokedAt: expect.anything(),
        lastHeartbeat: expect.anything(),
      }),
      { status: 'offline' },
    );
    expect(repo.save).not.toHaveBeenCalled();
    expect(credentialEventRepo.save).not.toHaveBeenCalled();
  });

  it('revokes only a browser owned by the current principal', async () => {
    const worker = buildWorker({
      workerKind: WorkerKind.BROWSER,
      ownerPrincipal: '7',
      credentialHash: `sha256:${'a'.repeat(64)}`,
    });
    repo.update = jest.fn().mockResolvedValue({ affected: 1 });

    await service.revokeBrowser(worker.id, '7');

    expect(repo.update).toHaveBeenCalledWith(
      {
        id: worker.id,
        workerKind: WorkerKind.BROWSER,
        ownerPrincipal: '7',
      },
      expect.objectContaining({
        status: 'revoked',
        credentialHash: null,
        revokedAt: expect.any(Date),
      }),
    );
    expect(repo.save).not.toHaveBeenCalled();
    expect(credentialEventRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        workerId: worker.id,
        action: 'revoked',
        actorPrincipal: '7',
      }),
    );
  });

  it('does not revoke a browser owned by another principal', async () => {
    repo.update = jest.fn().mockResolvedValue({ affected: 0 });

    await expect(
      service.revokeBrowser(
        '018f1d8a-54d7-7d63-a1ee-5e9a6adca704',
        'other-owner',
      ),
    ).rejects.toThrow('browser_installation_not_found');
    expect(credentialEventRepo.save).not.toHaveBeenCalled();
  });

  it('revokes any live worker credential through an audited admin action', async () => {
    const worker = buildWorker({
      workerKind: WorkerKind.MODELS,
      credentialHash: `sha256:${'a'.repeat(64)}`,
    });
    repo.findOne!.mockResolvedValue(worker);
    repo.save!.mockResolvedValue(worker);

    await service.revokeCredential(worker.id, 'admin-user');

    expect(repo.findOne).toHaveBeenCalledWith({
      where: { id: worker.id, revokedAt: expect.anything() },
      lock: { mode: 'pessimistic_write' },
    });
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'revoked',
        revokedAt: expect.any(Date),
        credentialHash: null,
      }),
    );
    expect(credentialEventRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        workerId: worker.id,
        workerKind: WorkerKind.MODELS,
        action: 'revoked',
        actorType: 'user',
        actorPrincipal: 'admin-user',
      }),
    );
  });

  it('returns a bounded credential history without credential material', async () => {
    const event = {
      eventId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca705',
      workerId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca704',
      action: 'rotated',
      occurredAt: new Date(),
    } as WorkerCredentialEventEntity;
    credentialEventRepo.find!.mockResolvedValue([event]);

    await expect(service.credentialHistory(event.workerId)).resolves.toEqual([
      event,
    ]);
    expect(credentialEventRepo.find).toHaveBeenCalledWith({
      where: { workerId: event.workerId },
      order: { occurredAt: 'DESC' },
      take: 100,
    });
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

describe('WorkerController credential operations', () => {
  it.each(['credentialHistory', 'revokeCredential'] as const)(
    'protects %s with administrative permission',
    (method) => {
      expect(
        Reflect.getMetadata(
          PERMISSIONS_KEY,
          WorkerController.prototype[method],
        ),
      ).toEqual([Permission.USER_MANAGEMENT]);
    },
  );
});

import { randomUUID } from 'crypto';
import { In } from 'typeorm';
import { ExecutionEntity } from '../../src/execution/execution.entity';
import { ExecutionStepAttemptEntity } from '../../src/execution/execution-step-attempt.entity';
import { ExecutionStepEntity } from '../../src/execution/execution-step.entity';
import { ExecutionStepKind } from '../../src/execution/execution-step-kind.enum';
import { ExecutionPriority } from '../../src/execution/execution-priority.enum';
import { ExecutionStatus } from '../../src/execution/execution-status.enum';
import { WorkerEntity } from '../../src/worker/worker.entity';
import { WorkerKind } from '../../src/worker/worker-kind.enum';
import { ExecutionOperationEntity } from '../../src/execution/execution-operation.entity';
import { ExecutionOperationStatus } from '../../src/execution/execution-operation-status.enum';
import type { ExecutionFixture } from './fixture';
import { TEST_RUNTIME_FINGERPRINT } from './fixture';

export function registerWorkersCases(getContext: ExecutionFixture): void {
  it('registers and authenticates an isolated Models identity', async () => {
    const { workerService } = getContext();

    const workerId = randomUUID();
    const registration = await workerService.registerModels(
      workerId,
      'models-e2e',
      ['detect-language'],
      [ExecutionStepKind.SERVICE],
      1,
      { runtime: 'test' },
    );

    expect(registration.worker.id).toBe(workerId);
    expect(registration.credential).not.toContain(workerId);
    await expect(
      workerService.authenticate(
        workerId,
        registration.credential,
        WorkerKind.MODELS,
      ),
    ).resolves.toMatchObject({ id: workerId });
    await expect(
      workerService.authenticate(
        workerId,
        'wrong-credential',
        WorkerKind.MODELS,
      ),
    ).rejects.toThrow('invalid_worker_credential');
    const rotation = await workerService.registerModels(
      workerId,
      'models-e2e',
      [],
      [ExecutionStepKind.SERVICE],
      1,
      {},
    );
    expect(rotation.credential).not.toBe(registration.credential);
    await expect(
      workerService.authenticate(
        workerId,
        registration.credential,
        WorkerKind.MODELS,
      ),
    ).rejects.toThrow('invalid_worker_credential');
    await expect(
      workerService.authenticate(
        workerId,
        rotation.credential,
        WorkerKind.MODELS,
      ),
    ).resolves.toMatchObject({ id: workerId });
    await workerService.revokeCredential(workerId, 'admin-e2e');
    await expect(
      workerService.authenticate(
        workerId,
        rotation.credential,
        WorkerKind.MODELS,
      ),
    ).rejects.toThrow('invalid_worker_credential');
    await expect(workerService.credentialHistory(workerId)).resolves.toEqual([
      expect.objectContaining({
        action: 'revoked',
        actorType: 'user',
        actorPrincipal: 'admin-e2e',
      }),
      expect.objectContaining({ action: 'rotated', actorType: 'service' }),
      expect.objectContaining({ action: 'issued', actorType: 'service' }),
    ]);
  });

  it('enrolls and revokes a browser identity without Models access', async () => {
    const { dataSource, attemptService, workerService } = getContext();

    const installationId = randomUUID();
    const registration = await workerService.enrollBrowser(
      installationId,
      'ia-browser-e2e',
      'browser-owner',
      { runtime: 'test' },
    );

    await expect(
      workerService.authenticate(
        installationId,
        registration.credential,
        WorkerKind.BROWSER,
      ),
    ).resolves.toMatchObject({
      id: installationId,
      workerKind: WorkerKind.BROWSER,
      ownerPrincipal: 'browser-owner',
      capabilities: expect.arrayContaining([
        'tool.browser.read_current_page/1',
        'tool.browser.navigate/1',
        'tool.browser.go_back/1',
        'tool.browser.click/1',
        'tool.browser.type_text/1',
        'tool.browser.select_option/1',
      ]),
      stepKinds: [ExecutionStepKind.TOOL],
    });
    await expect(
      workerService.authenticate(
        installationId,
        registration.credential,
        WorkerKind.MODELS,
      ),
    ).rejects.toThrow('invalid_worker_credential');

    await workerService.revokeBrowser(installationId, 'browser-owner');
    await expect(
      workerService.authenticate(
        installationId,
        registration.credential,
        WorkerKind.BROWSER,
      ),
    ).rejects.toThrow('invalid_worker_credential');
    await expect(
      attemptService.claimReadyStep({
        workerId: installationId,
        ownerPrincipal: 'browser-owner',
        stepKinds: [ExecutionStepKind.TOOL],
        capabilities: ['tool.browser.navigate/1'],
        leaseDurationMs: 30_000,
        enforceRegisteredWorkerCapacity: true,
      }),
    ).rejects.toThrow('worker_not_available');
    await expect(
      dataSource.getRepository(WorkerEntity).findOneByOrFail({
        id: installationId,
      }),
    ).resolves.toMatchObject({
      status: 'revoked',
      revokedAt: expect.any(Date),
    });
    await expect(
      workerService.credentialHistory(installationId),
    ).resolves.toEqual([
      expect.objectContaining({
        action: 'revoked',
        actorType: 'user',
        actorPrincipal: 'browser-owner',
      }),
      expect.objectContaining({
        action: 'issued',
        actorType: 'user',
        actorPrincipal: 'browser-owner',
      }),
    ]);
  });

  it('serializes concurrent claims at the registered worker limit', async () => {
    const { service, attemptService, workerService } = getContext();

    const workerId = randomUUID();
    await workerService.registerModels(
      workerId,
      'models-concurrency-e2e',
      ['detect-language'],
      [ExecutionStepKind.SERVICE],
      1,
      { runtime: 'test' },
    );
    await Promise.all(
      ['worker-limit-first', 'worker-limit-second'].map(() =>
        service.create(
          'detect-language',
          ExecutionPriority.NORMAL,
          { resourceId: 7, samples: ['Hello'] },
          {
            initialStep: {
              stepKind: ExecutionStepKind.SERVICE,
              work: {
                taskType: 'detect-language',
                payload: { resourceId: 7, samples: ['Hello'] },
              },
              requiredCapabilities: ['detect-language'],
            },
          },
        ),
      ),
    );

    const claims = await Promise.all([
      attemptService.claimReadyStep({
        workerId,
        stepKinds: [ExecutionStepKind.SERVICE],
        capabilities: ['detect-language'],
        leaseDurationMs: 30_000,
        enforceRegisteredWorkerCapacity: true,
      }),
      attemptService.claimReadyStep({
        workerId,
        stepKinds: [ExecutionStepKind.SERVICE],
        capabilities: ['detect-language'],
        leaseDurationMs: 30_000,
        enforceRegisteredWorkerCapacity: true,
      }),
    ]);

    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.filter((claim) => claim === null)).toHaveLength(1);
    const registration = (await workerService.registrations()).find(
      (worker) => worker.workerId === workerId,
    );
    expect(registration).toEqual(
      expect.objectContaining({
        concurrency: { maximum: 1, available: 0 },
        activeAssignments: [claims.find(Boolean)?.attemptId],
        loadSummary: { state: 'busy', active: 1 },
      }),
    );
  });

  it('serializes resource claims and acknowledges result retries', async () => {
    const { dataSource, service, attemptService, terminalCandidateService } =
      getContext();

    const resourceKey = `resource:${randomUUID()}`;
    const executions = await Promise.all(
      ['first', 'second'].map(() =>
        service.create(
          'detect-language',
          ExecutionPriority.NORMAL,
          { resourceId: 7, samples: ['Hello'] },
          {
            initialStep: {
              stepKind: ExecutionStepKind.SERVICE,
              work: {
                taskType: 'detect-language',
                payload: { resourceId: 7, samples: ['Hello'] },
              },
              resourceKeys: [resourceKey],
            },
          },
        ),
      ),
    );
    const steps = await dataSource.getRepository(ExecutionStepEntity).findBy({
      executionId: In(executions.map((execution) => execution.executionId)),
    });
    expect(steps).toHaveLength(2);

    const claims = await Promise.allSettled(
      steps.map((step) =>
        attemptService.grantAttempt({
          stepId: step.stepId,
          workerId: randomUUID(),
          leaseDurationMs: 30_000,
        }),
      ),
    );
    const granted = claims.filter(
      (claim): claim is PromiseFulfilledResult<ExecutionStepAttemptEntity> =>
        claim.status === 'fulfilled',
    );
    const rejected = claims.filter(
      (claim): claim is PromiseRejectedResult => claim.status === 'rejected',
    );
    expect(granted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0].reason)).toContain('resource_conflict');

    const attempt = granted[0].value;
    await attemptService.startAttempt(attempt.attemptId, attempt.claimedBy);
    const resultEnvelope = {
      schemaVersion: 'step-result/1',
      executionId: attempt.executionId,
      stepId: attempt.stepId,
      operationId: attempt.operationId,
      attemptId: attempt.attemptId,
      stepKind: ExecutionStepKind.SERVICE,
      status: 'succeeded',
      runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
      output: { kind: 'service', value: { language: 'en' } },
      artifactRefs: [],
      error: null,
    } as const;
    const result = {
      executionId: resultEnvelope.executionId,
      stepId: resultEnvelope.stepId,
      operationId: resultEnvelope.operationId,
      attemptId: resultEnvelope.attemptId,
      workerId: attempt.claimedBy,
      result: resultEnvelope,
    };
    await expect(attemptService.receiveResult(result)).resolves.toMatchObject({
      code: 'received',
      receiptId: expect.any(String),
    });
    await expect(attemptService.receiveResult(result)).resolves.toMatchObject({
      code: 'duplicate',
      receiptId: expect.any(String),
    });
    await expect(attemptService.processReceivedResults()).resolves.toBe(1);
    await expect(
      dataSource.getRepository(ExecutionOperationEntity).findOneByOrFail({
        operationId: attempt.operationId,
      }),
    ).resolves.toMatchObject({
      operationId: attempt.operationId,
      status: ExecutionOperationStatus.SUCCEEDED,
      currentAttemptId: null,
      result: { kind: 'service', value: { language: 'en' } },
    });
    await expect(
      dataSource.getRepository(ExecutionEntity).findOneByOrFail({
        executionId: attempt.executionId,
      }),
    ).resolves.toMatchObject({
      status: ExecutionStatus.RUNNING,
      phase: 'coordination_pending',
      result: { language: 'en' },
    });
    await expect(terminalCandidateService.promoteReady()).resolves.toBe(1);
  });
}

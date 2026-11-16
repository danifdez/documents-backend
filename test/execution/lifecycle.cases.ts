import { randomUUID } from 'crypto';
import { ExecutionArtifactEntity } from '../../src/execution/execution-artifact.entity';
import { ExecutionContractValidator } from '../../src/execution/execution-contract-validator';
import { ExecutionEventEntity } from '../../src/execution/execution-event.entity';
import { ExecutionEntity } from '../../src/execution/execution.entity';
import { ExecutionStepEntity } from '../../src/execution/execution-step.entity';
import { ExecutionStepStatus } from '../../src/execution/execution-step-status.enum';
import { ExecutionStepKind } from '../../src/execution/execution-step-kind.enum';
import { ExecutionPriority } from '../../src/execution/execution-priority.enum';
import { ExecutionStatus } from '../../src/execution/execution-status.enum';
import { ExecutionOutboxEntity } from '../../src/execution-outbox/execution-outbox.entity';
import { ExecutionOperationEntity } from '../../src/execution/execution-operation.entity';
import { ExecutionOperationStatus } from '../../src/execution/execution-operation-status.enum';
import type { ExecutionFixture } from './fixture';
import { TEST_RUNTIME_FINGERPRINT, TEST_CODE_FINGERPRINT } from './fixture';

export function registerLifecycleCases(getContext: ExecutionFixture): void {
  it('commits an execution and its initial step atomically', async () => {
    const { dataSource, service, attemptService } = getContext();

    const inputBody = Buffer.alloc(8 * 1024 * 1024 + 1, 'a');
    const payload = { resourceId: 7, samples: ['Hello'] };
    const created = await service.create(
      'detect-language',
      ExecutionPriority.NORMAL,
      payload,
      {
        inputArtifacts: [
          {
            role: 'source',
            kind: 'language_sample',
            mediaType: 'text/plain',
            body: inputBody,
          },
        ],
        initialStep: {
          stepKind: ExecutionStepKind.CODE,
          work: { taskType: 'detect-language', payload },
          requiredCapabilities: ['detect-language'],
          resourceKeys: ['resource:language-detection'],
        },
      },
    );

    expect(created.schemaVersion).toBe('execution/1');
    const initialStep = await dataSource
      .getRepository(ExecutionStepEntity)
      .findOneByOrFail({
        executionId: created.executionId,
      });
    expect(initialStep).toMatchObject({
      executionId: created.executionId,
      schemaVersion: 'step/1',
      stepKind: ExecutionStepKind.CODE,
      status: 'ready',
      work: { taskType: 'detect-language', payload },
    });
    const storedInput = await dataSource
      .getRepository(ExecutionArtifactEntity)
      .createQueryBuilder('artifact')
      .addSelect('artifact.body')
      .where('artifact.artifact_id = :artifactId', {
        artifactId: initialStep.inputArtifactRefs[0].artifactId,
      })
      .getOneOrFail();
    expect(storedInput.body).toBeNull();
    expect(storedInput.storageRef).toMatch(/^file:v1\//);
    await expect(
      dataSource.getRepository(ExecutionOperationEntity).findOneByOrFail({
        operationId: initialStep.operationId,
      }),
    ).resolves.toMatchObject({
      executionId: created.executionId,
      stepId: initialStep.stepId,
      operationId: initialStep.operationId,
      schemaVersion: 'operation/1',
      status: ExecutionOperationStatus.PREPARED,
      causedByEventId: created.lastEventId,
    });

    const countBeforeRollback = await dataSource
      .getRepository(ExecutionEntity)
      .count();
    await expect(
      service.create('detect-language', ExecutionPriority.NORMAL, payload, {
        initialStep: {
          stepKind: ExecutionStepKind.CODE,
          work: { taskType: 'detect-language', payload },
          availableAt: new Date('2026-08-19T10:00:00Z'),
          deadline: new Date('2026-08-19T09:00:00Z'),
        },
      }),
    ).rejects.toThrow('invalid_step_deadline');
    await expect(
      dataSource.getRepository(ExecutionEntity).count(),
    ).resolves.toBe(countBeforeRollback);

    const workerId = randomUUID();
    const assignment = await attemptService.claimReadyStep({
      workerId,
      stepKinds: [ExecutionStepKind.CODE],
      capabilities: ['detect-language'],
      leaseDurationMs: 30_000,
    });
    expect(assignment).toMatchObject({
      schemaVersion: 'step-assignment/1',
      executionId: created.executionId,
      stepKind: ExecutionStepKind.CODE,
      work: { taskType: 'detect-language', payload },
    });
    expect(assignment!.inputArtifactRefs).toHaveLength(1);
    expect(assignment!.inputArtifactRefs[0].dataPolicy).toEqual({
      classification: 'workspace',
      allowedPurposes: ['execution'],
      allowedDestinations: ['documents-models'],
      retentionClass: 'operational',
      expiresAt: expect.any(String),
      sourceRefs: [],
    });
    const hydratedInput = await attemptService.getInputArtifact(
      assignment!.attemptId,
      workerId,
      assignment!.inputArtifactRefs[0].artifactId,
    );
    expect(hydratedInput.mediaType).toBe('text/plain');
    expect(hydratedInput.body?.equals(inputBody)).toBe(true);
    await expect(
      attemptService.renewAttemptLease(assignment!.attemptId, workerId, 60_000),
    ).resolves.toMatchObject({ cancelled: false });
    await expect(
      attemptService.readAttemptControl(assignment!.attemptId, workerId),
    ).resolves.toMatchObject({ cancelled: false });
  });

  it('persists one-shot model work as an inference step', async () => {
    const { dataSource, service } = getContext();

    const payload = {
      question: 'What is this document about?',
      graphContext: [],
    };
    const created = await service.createInference(
      'ask',
      ExecutionPriority.NORMAL,
      payload,
    );

    await expect(
      dataSource.getRepository(ExecutionStepEntity).findOneByOrFail({
        executionId: created.executionId,
      }),
    ).resolves.toMatchObject({
      stepKind: ExecutionStepKind.INFERENCE,
      work: { taskType: 'ask', payload },
      requiredCapabilities: ['ask'],
    });
  });

  it('persists domain reconciliation policy for failed steps', async () => {
    const { dataSource, service } = getContext();

    const payload = {
      datasetId: 3,
      recordId: 5,
      resourceId: 7,
      projectId: null,
      schema: [],
      columnsToExtract: [],
      documentText: 'Dataset row source',
      sourceTitle: 'Source',
      isAudio: false,
      model: 'e2e-model',
    };
    const created = await service.createInference(
      'dataset.extract-row',
      ExecutionPriority.NORMAL,
      payload,
      { finalizeOnFailure: true },
    );

    await expect(
      dataSource.getRepository(ExecutionStepEntity).findOneByOrFail({
        executionId: created.executionId,
      }),
    ).resolves.toMatchObject({
      stepKind: ExecutionStepKind.INFERENCE,
      finalizeOnFailure: true,
    });
  });

  it('preserves tree identity and artifacts for child inference work', async () => {
    const { dataSource, service, attemptService, terminalCandidateService } =
      getContext();

    const parent = await service.create(
      'document-extraction',
      ExecutionPriority.NORMAL,
      { resourceId: 7, hash: 'source-hash', extension: '.wav' },
    );
    const media = Buffer.from('media-body');
    const child = await service.createInference(
      'transcribe',
      ExecutionPriority.BACKGROUND,
      { resourceId: 7, hash: 'source-hash', extension: '.wav' },
      {
        rootExecutionId: parent.rootExecutionId,
        parentExecutionId: parent.executionId,
        ownerPrincipal: parent.ownerPrincipal,
        inputArtifacts: [
          {
            role: 'media',
            kind: 'source_media',
            mediaType: 'audio/wav',
            body: media,
          },
        ],
      },
    );

    expect(child).toMatchObject({
      rootExecutionId: parent.rootExecutionId,
      parentExecutionId: parent.executionId,
      ownerPrincipal: parent.ownerPrincipal,
    });
    const step = await dataSource
      .getRepository(ExecutionStepEntity)
      .findOneByOrFail({ executionId: child.executionId });
    expect(step).toMatchObject({
      stepKind: ExecutionStepKind.INFERENCE,
      inputArtifactRefs: [{ role: 'media' }],
    });
    const artifact = await dataSource
      .getRepository(ExecutionArtifactEntity)
      .createQueryBuilder('artifact')
      .addSelect('artifact.body')
      .where('artifact.artifact_id = :artifactId', {
        artifactId: step.inputArtifactRefs[0].artifactId,
      })
      .getOneOrFail();
    expect(artifact).toMatchObject({
      rootExecutionId: parent.rootExecutionId,
      kind: 'source_media',
      mediaType: 'audio/wav',
      body: media,
    });

    const workerId = randomUUID();
    const assignment = await attemptService.claimReadyStep({
      workerId,
      stepKinds: [ExecutionStepKind.INFERENCE],
      capabilities: ['transcribe'],
      leaseDurationMs: 30_000,
    });
    expect(assignment).toMatchObject({
      executionId: child.executionId,
      stepId: step.stepId,
      inputArtifactRefs: [{ role: 'media' }],
    });
    await attemptService.startAttempt(assignment!.attemptId, workerId);
    await attemptService.receiveResult({
      executionId: assignment!.executionId,
      stepId: assignment!.stepId,
      operationId: assignment!.operationId,
      attemptId: assignment!.attemptId,
      workerId,
      result: {
        schemaVersion: 'step-result/1',
        executionId: assignment!.executionId,
        stepId: assignment!.stepId,
        operationId: assignment!.operationId,
        attemptId: assignment!.attemptId,
        stepKind: ExecutionStepKind.INFERENCE,
        status: 'succeeded',
        output: {
          kind: ExecutionStepKind.INFERENCE,
          outcome: {
            kind: 'structured_result',
            schemaId: 'transcribe-output/1',
            value: { transcript: 'Hello' },
          },
        },
        codeFingerprint: TEST_CODE_FINGERPRINT,
        runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
        usage: {
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
        },
        inference: {
          effectiveModel: 'e2e-whisper',
          effectiveAdapter: null,
          effectivePromptPackages: ['transcribe/1'],
          finishReason: 'completed',
          inferenceMs: 1,
          cacheOutcome: 'unknown',
          warnings: [],
        },
        artifactRefs: [],
        error: null,
      },
    });
    await expect(attemptService.processReceivedResults()).resolves.toBe(1);

    const treeEvents = await dataSource
      .getRepository(ExecutionEventEntity)
      .find({
        where: { rootExecutionId: parent.rootExecutionId },
        order: { sequence: 'ASC' },
      });
    expect(treeEvents.map((event) => event.sequence)).toEqual([
      '1',
      '2',
      '3',
      '4',
    ]);
    expect(treeEvents.map((event) => event.eventType)).toEqual([
      'execution.created',
      'execution.created',
      'operation.started',
      'operation.finished',
    ]);
    const persistedRoot = await dataSource
      .getRepository(ExecutionEntity)
      .findOneByOrFail({ executionId: parent.executionId });
    const persistedChild = await dataSource
      .getRepository(ExecutionEntity)
      .findOneByOrFail({ executionId: child.executionId });
    expect(persistedRoot.lastSequence).toBe('4');
    expect(persistedRoot.lastEventId).toBe(treeEvents[3].eventId);
    expect(persistedChild).toMatchObject({
      phase: 'coordination_pending',
      result: { transcript: 'Hello' },
      lastSequence: '4',
      lastEventId: treeEvents[3].eventId,
    });
    await expect(terminalCandidateService.promoteReady()).resolves.toBe(1);
    await expect(
      dataSource
        .getRepository(ExecutionEntity)
        .findOneByOrFail({ executionId: child.executionId }),
    ).resolves.toMatchObject({ phase: 'backend_finalization' });
  });

  it('propagates durable cancellation through active child attempts', async () => {
    const { dataSource, service, attemptService } = getContext();

    const ownerPrincipal = 'cancellation-tree-e2e';
    const parent = await service.create(
      'document-extraction',
      ExecutionPriority.NORMAL,
      { resourceId: 9, hash: 'source-hash', extension: '.wav' },
      { ownerPrincipal },
    );
    const child = await service.createInference(
      'transcribe',
      ExecutionPriority.NORMAL,
      { resourceId: 9, hash: 'source-hash', extension: '.wav' },
      {
        rootExecutionId: parent.executionId,
        parentExecutionId: parent.executionId,
        ownerPrincipal,
      },
    );
    const childStep = await dataSource
      .getRepository(ExecutionStepEntity)
      .findOneByOrFail({ executionId: child.executionId });
    const workerId = randomUUID();
    const attempt = await attemptService.grantAttempt({
      stepId: childStep.stepId,
      workerId,
      leaseDurationMs: 30_000,
    });

    await expect(
      service.requestCancellation(
        parent.executionId,
        { ownerPrincipal },
        'User stopped the execution',
      ),
    ).resolves.toMatchObject({
      rootExecutionId: parent.executionId,
      status: ExecutionStatus.QUEUED,
      cancellationReason: 'User stopped the execution',
    });
    await expect(
      attemptService.readAttemptControl(attempt.attemptId, workerId),
    ).resolves.toMatchObject({ cancelled: true });
    await expect(
      dataSource
        .getRepository(ExecutionStepEntity)
        .findOneByOrFail({ executionId: parent.executionId }),
    ).resolves.toMatchObject({ status: ExecutionStepStatus.CANCELLED });
    await expect(
      dataSource
        .getRepository(ExecutionStepEntity)
        .findOneByOrFail({ executionId: child.executionId }),
    ).resolves.toMatchObject({ status: ExecutionStepStatus.RUNNING });
    await expect(service.reconcileRequestedCancellations()).resolves.toBe(0);

    await expect(
      attemptService.expireAttempt(
        attempt.attemptId,
        new Date(attempt.leaseExpiresAt.getTime() + 1),
      ),
    ).resolves.toBe(true);
    await expect(service.finalizePendingTerminals()).resolves.toBe(1);
    await expect(service.reconcileRequestedCancellations()).resolves.toBe(1);

    const executions = await dataSource.getRepository(ExecutionEntity).find({
      where: { rootExecutionId: parent.executionId },
    });
    expect(executions).toHaveLength(2);
    expect(executions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          executionId: parent.executionId,
          status: ExecutionStatus.CANCELLED,
          cancellationReason: 'User stopped the execution',
        }),
        expect.objectContaining({
          executionId: child.executionId,
          status: ExecutionStatus.CANCELLED,
          cancellationReason: 'User stopped the execution',
        }),
      ]),
    );
    await expect(
      dataSource
        .getRepository(ExecutionOperationEntity)
        .findOneByOrFail({ operationId: childStep.operationId }),
    ).resolves.toMatchObject({
      status: ExecutionOperationStatus.CANCELLED,
      currentAttemptId: null,
    });
    const cancellationEvents = await dataSource
      .getRepository(ExecutionEventEntity)
      .find({
        where: { rootExecutionId: parent.executionId },
        order: { sequence: 'ASC' },
      });
    const validator = new ExecutionContractValidator();
    for (const event of cancellationEvents) {
      validator.assertEvent(event.envelope);
    }
    expect(
      cancellationEvents.filter(
        (event) =>
          event.eventType === 'execution.state_changed' &&
          (event.envelope.payload as Record<string, unknown> | undefined)
            ?.phase === 'cancellation_requested',
      ),
    ).toHaveLength(2);
  });

  it('commits terminal state, event and publication in one transaction', async () => {
    const { dataSource, service } = getContext();

    const created = await service.create('ask', ExecutionPriority.NORMAL, {
      requestId: 'request-1',
      question: 'Request one',
      graphContext: [],
    });

    await service.markAsCompleted(created.executionId, {
      publication: {
        socketEvent: 'askResponse',
        payload: { response: 'done', requestId: 'request-1' },
      },
    });

    const terminal = await dataSource
      .getRepository(ExecutionEntity)
      .findOneByOrFail({ executionId: created.executionId });
    const publication = await dataSource
      .getRepository(ExecutionOutboxEntity)
      .findOneByOrFail({ executionId: created.executionId });
    expect(terminal.status).toBe(ExecutionStatus.COMPLETED);
    expect(publication).toMatchObject({
      eventId: terminal.lastEventId,
      schemaVersion: 'execution-outbox/1',
      socketEvent: 'askResponse',
      payload: { response: 'done', requestId: 'request-1' },
      status: 'pending',
    });
  });
}

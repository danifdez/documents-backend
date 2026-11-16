import { randomUUID } from 'crypto';
import { ExecutionEntity } from '../../src/execution/execution.entity';
import { ExecutionStepEntity } from '../../src/execution/execution-step.entity';
import { ExecutionStepStatus } from '../../src/execution/execution-step-status.enum';
import { ExecutionStepKind } from '../../src/execution/execution-step-kind.enum';
import { ExecutionPriority } from '../../src/execution/execution-priority.enum';
import { ExecutionStatus } from '../../src/execution/execution-status.enum';
import type { ExecutionFixture } from './fixture';
import { TEST_RUNTIME_FINGERPRINT, TEST_CODE_FINGERPRINT } from './fixture';

export function registerReductionCases(getContext: ExecutionFixture): void {
  it('runs summarize fan-out and fan-in on the canonical step graph', async () => {
    const { dataSource, service, attemptService, terminalCandidateService } =
      getContext();

    const firstMapId = randomUUID();
    const secondMapId = randomUUID();
    const created = await service.create(
      'summarize',
      ExecutionPriority.NORMAL,
      { targetLanguage: 'en', type: 'summary' },
      {
        steps: [
          {
            stepId: firstMapId,
            stepKind: ExecutionStepKind.INFERENCE,
            work: {
              taskType: 'summarize-map',
              payload: {
                content: 'first',
                chunkIndex: 0,
                targetLanguage: 'en',
              },
            },
            requiredCapabilities: ['summarize-map'],
          },
          {
            stepId: secondMapId,
            stepKind: ExecutionStepKind.INFERENCE,
            work: {
              taskType: 'summarize-map',
              payload: {
                content: 'second',
                chunkIndex: 1,
                targetLanguage: 'en',
              },
            },
            requiredCapabilities: ['summarize-map'],
          },
          {
            stepKind: ExecutionStepKind.INFERENCE,
            dependsOnStepIds: [firstMapId, secondMapId],
            work: {
              taskType: 'summarize-reduce',
              payload: { targetLanguage: 'en', reductionLevel: 1 },
              coordination: {
                kind: 'map-reduce-reduce/1',
                mapStepIds: [firstMapId, secondMapId],
                resultKey: 'response',
              },
            },
            requiredCapabilities: ['summarize-reduce'],
          },
        ],
      },
    );
    const workerId = randomUUID();
    const inferenceMetadata = {
      codeFingerprint: TEST_CODE_FINGERPRINT,
      runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
      usage: {
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
      },
      inference: {
        effectiveModel: 'e2e-model',
        effectiveAdapter: null,
        effectivePromptPackages: ['e2e-prompt'],
        finishReason: 'completed',
        inferenceMs: 1,
        cacheOutcome: 'unknown',
        warnings: [],
      },
    };
    const assignments = await Promise.all([
      attemptService.claimReadyStep({
        workerId,
        stepKinds: [ExecutionStepKind.INFERENCE],
        capabilities: ['summarize-map'],
        leaseDurationMs: 30_000,
      }),
      attemptService.claimReadyStep({
        workerId,
        stepKinds: [ExecutionStepKind.INFERENCE],
        capabilities: ['summarize-map'],
        leaseDurationMs: 30_000,
      }),
    ]);
    expect(assignments.every(Boolean)).toBe(true);

    for (const assignment of assignments.reverse()) {
      await attemptService.startAttempt(assignment!.attemptId, workerId);
      const chunkIndex = Number(
        (assignment!.work.payload as Record<string, unknown>).chunkIndex,
      );
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
              schemaId: 'summarize-map-output/1',
              value: { response: chunkIndex === 0 ? 'first' : 'second' },
            },
          },
          ...inferenceMetadata,
          artifactRefs: [],
          error: null,
        },
      });
    }
    await expect(attemptService.processReceivedResults()).resolves.toBe(2);

    const reduceAssignment = await attemptService.claimReadyStep({
      workerId,
      stepKinds: [ExecutionStepKind.INFERENCE],
      capabilities: ['summarize-reduce'],
      leaseDurationMs: 30_000,
    });
    expect(reduceAssignment?.work).toMatchObject({
      taskType: 'summarize-reduce',
      payload: { partials: ['first', 'second'] },
    });
    await attemptService.startAttempt(reduceAssignment!.attemptId, workerId);
    await attemptService.receiveResult({
      executionId: reduceAssignment!.executionId,
      stepId: reduceAssignment!.stepId,
      operationId: reduceAssignment!.operationId,
      attemptId: reduceAssignment!.attemptId,
      workerId,
      result: {
        schemaVersion: 'step-result/1',
        executionId: reduceAssignment!.executionId,
        stepId: reduceAssignment!.stepId,
        operationId: reduceAssignment!.operationId,
        attemptId: reduceAssignment!.attemptId,
        stepKind: ExecutionStepKind.INFERENCE,
        status: 'succeeded',
        output: {
          kind: ExecutionStepKind.INFERENCE,
          outcome: {
            kind: 'structured_result',
            schemaId: 'summarize-reduce-output/1',
            value: { response: 'merged' },
          },
        },
        ...inferenceMetadata,
        artifactRefs: [],
        error: null,
      },
    });
    await expect(attemptService.processReceivedResults()).resolves.toBe(1);
    await expect(
      dataSource.getRepository(ExecutionEntity).findOneByOrFail({
        executionId: created.executionId,
      }),
    ).resolves.toMatchObject({
      status: ExecutionStatus.RUNNING,
      phase: 'coordination_pending',
      result: { response: 'merged' },
    });
    await expect(terminalCandidateService.promoteReady()).resolves.toBe(1);
  });

  it('materializes oversized chat input through a durable reduction graph', async () => {
    const { dataSource, attemptService, agentLoopService, createChat } =
      getContext();

    const message =
      `Create the report. ${'source material '.repeat(1400)}` +
      'Keep the final CSV constraint.';
    const created = await createChat(
      'assistant_chat',
      message,
      { ownerPrincipal: 'large-context-e2e' },
      { ownerId: 1 },
    );
    const workerId = randomUUID();
    const metadata = {
      codeFingerprint: TEST_CODE_FINGERPRINT,
      runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
      usage: {
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
      },
      inference: {
        effectiveModel: 'e2e-model',
        effectiveAdapter: null,
        effectivePromptPackages: ['e2e-prompt'],
        finishReason: 'completed',
        inferenceMs: 1,
        cacheOutcome: 'unknown',
        warnings: [],
      },
    };
    const initialSteps = await dataSource
      .getRepository(ExecutionStepEntity)
      .find({ where: { executionId: created.executionId } });
    const maps = initialSteps.filter(
      (step) => step.work.taskType === 'context-input-map',
    );
    expect(maps.length).toBeGreaterThan(1);
    expect(
      initialSteps.find((step) => step.work.taskType === 'assistant-chat'),
    ).toMatchObject({ status: ExecutionStepStatus.BLOCKED });

    for (let index = 0; index < maps.length; index += 1) {
      const mapWorkerId = randomUUID();
      const assignment = await attemptService.claimReadyStep({
        workerId: mapWorkerId,
        stepKinds: [ExecutionStepKind.INFERENCE],
        capabilities: ['context-input-map'],
        leaseDurationMs: 30_000,
      });
      expect(assignment).not.toBeNull();
      await attemptService.startAttempt(assignment!.attemptId, mapWorkerId);
      const chunkIndex = Number(
        (assignment!.work.payload as Record<string, unknown>).chunkIndex,
      );
      await attemptService.receiveResult({
        executionId: assignment!.executionId,
        stepId: assignment!.stepId,
        operationId: assignment!.operationId,
        attemptId: assignment!.attemptId,
        workerId: mapWorkerId,
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
              schemaId: 'context-input-map-output/1',
              value: { digest: `digest-${chunkIndex}` },
            },
          },
          ...metadata,
          artifactRefs: [],
          error: null,
        },
      });
      await expect(attemptService.processReceivedResults()).resolves.toBe(1);
    }

    const reduction = await attemptService.claimReadyStep({
      workerId,
      stepKinds: [ExecutionStepKind.INFERENCE],
      capabilities: ['context-input-reduce'],
      leaseDurationMs: 30_000,
    });
    expect(reduction?.work).toMatchObject({
      taskType: 'context-input-reduce',
      payload: {
        partials: maps.map((_step, index) => `digest-${index}`),
      },
    });
    await attemptService.startAttempt(reduction!.attemptId, workerId);
    await attemptService.receiveResult({
      executionId: reduction!.executionId,
      stepId: reduction!.stepId,
      operationId: reduction!.operationId,
      attemptId: reduction!.attemptId,
      workerId,
      result: {
        schemaVersion: 'step-result/1',
        executionId: reduction!.executionId,
        stepId: reduction!.stepId,
        operationId: reduction!.operationId,
        attemptId: reduction!.attemptId,
        stepKind: ExecutionStepKind.INFERENCE,
        status: 'succeeded',
        output: {
          kind: ExecutionStepKind.INFERENCE,
          outcome: {
            kind: 'structured_result',
            schemaId: 'context-input-reduce-output/1',
            value: { digest: 'Complete reduced user request' },
          },
        },
        ...metadata,
        artifactRefs: [],
        error: null,
      },
    });
    await expect(attemptService.processReceivedResults()).resolves.toBe(1);
    await expect(agentLoopService.prepareReadyInferences()).resolves.toBe(1);

    const finalAssignment = await attemptService.claimReadyStep({
      workerId,
      stepKinds: [ExecutionStepKind.INFERENCE],
      capabilities: ['assistant-chat'],
      leaseDurationMs: 30_000,
    });
    expect(finalAssignment?.work.taskType).toBe('assistant-chat');
    const contextRef = finalAssignment!.inputArtifactRefs.find(
      (ref) => ref.role === 'active_context',
    );
    expect(contextRef).toBeDefined();
    const rows = await dataSource.query(
      'SELECT "body" FROM "execution_artifacts" WHERE "artifact_id" = $1',
      [contextRef!.artifactId],
    );
    const snapshot = JSON.parse((rows[0].body as Buffer).toString('utf8'));
    expect(snapshot.effectivePayload.activeInputReduction).toMatchObject({
      schemaVersion: 'active-input-reduction/1',
      strategy: 'chunk-map-reduce/1',
      chunkCount: maps.length,
      digest: 'Complete reduced user request',
    });
  });
}

import { randomUUID } from 'crypto';
import { ExecutionArtifactEntity } from '../../src/execution/execution-artifact.entity';
import { ExecutionEventEntity } from '../../src/execution/execution-event.entity';
import { ExecutionStepEntity } from '../../src/execution/execution-step.entity';
import { ExecutionStepStatus } from '../../src/execution/execution-step-status.enum';
import { ExecutionStepKind } from '../../src/execution/execution-step-kind.enum';
import { contentHash } from '../../src/execution/execution.service';
import { ExecutionToolPlanEntity } from '../../src/execution/execution-tool-plan.entity';
import type { ExecutionFixture } from './fixture';
import { TEST_RUNTIME_FINGERPRINT, TEST_CODE_FINGERPRINT } from './fixture';

export function registerBrowserToolsCases(getContext: ExecutionFixture): void {
  it('routes a browser tool request through IA Browser and into the next inference', async () => {
    const {
      dataSource,
      attemptService,
      workerService,
      agentLoopService,
      createChat,
    } = getContext();

    const browserId = randomUUID();
    await workerService.enrollBrowser(
      browserId,
      'ia-browser-agent-loop-e2e',
      'agent-loop-e2e',
      { runtime: 'test' },
    );
    const created = await createChat(
      'assistant_chat',
      'Find the harness plan',
      { ownerPrincipal: 'agent-loop-e2e' },
      {},
    );
    await expect(agentLoopService.prepareReadyInferences()).resolves.toBe(1);
    const governedStep = await dataSource
      .getRepository(ExecutionStepEntity)
      .findOneByOrFail({ executionId: created.executionId });
    expect(governedStep.budgetReservationId).toEqual(expect.any(String));

    const workerId = randomUUID();
    const assignment = await attemptService.claimReadyStep({
      workerId,
      stepKinds: [ExecutionStepKind.INFERENCE],
      capabilities: ['assistant-chat'],
      leaseDurationMs: 30_000,
    });
    expect(assignment).not.toBeNull();
    await attemptService.startAttempt(assignment!.attemptId, workerId);
    const toolCallId = randomUUID();
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
        codeFingerprint: TEST_CODE_FINGERPRINT,
        runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
        output: {
          kind: ExecutionStepKind.INFERENCE,
          outcome: {
            kind: 'tool_requests',
            calls: [
              {
                toolCallId,
                name: 'browser.read_current_page',
                arguments: {
                  expectedUrl: 'https://example.test/harness',
                  maxChars: 12_000,
                },
              },
            ],
          },
        },
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        },
        inference: {
          effectiveModel: 'e2e-model',
          effectiveAdapter: null,
          effectivePromptPackages: ['e2e-prompt'],
          finishReason: 'tool_calls',
          inferenceMs: 1,
          cacheOutcome: 'miss',
          warnings: [],
        },
        artifactRefs: [],
        error: null,
      },
    });
    await expect(attemptService.processReceivedResults()).resolves.toBe(1);
    await expect(
      agentLoopService.materializeAcceptedToolRequests(),
    ).resolves.toBe(1);

    const plan = await dataSource
      .getRepository(ExecutionToolPlanEntity)
      .findOneByOrFail({ toolCallId });
    expect(plan.stepId).toEqual(expect.any(String));
    await expect(
      dataSource
        .getRepository(ExecutionStepEntity)
        .findOneByOrFail({ stepId: plan.stepId! }),
    ).resolves.toMatchObject({
      status: ExecutionStepStatus.READY,
      stepKind: ExecutionStepKind.TOOL,
      budgetReservationId: expect.any(String),
      work: {
        taskType: 'browser.read_current_page',
        toolPlan: { toolCallId, operationId: plan.operationId },
      },
      requiredCapabilities: ['tool.browser.read_current_page/1'],
    });
    await expect(
      agentLoopService.materializeAcceptedToolRequests(),
    ).resolves.toBe(0);
    await expect(
      dataSource
        .getRepository(ExecutionStepEntity)
        .findOneByOrFail({ stepId: assignment!.stepId }),
    ).resolves.toMatchObject({ continuationProcessedAt: expect.any(Date) });

    const browserAssignment = await attemptService.claimReadyStep({
      workerId: browserId,
      ownerPrincipal: 'agent-loop-e2e',
      stepKinds: [ExecutionStepKind.TOOL],
      capabilities: ['tool.browser.read_current_page/1'],
      leaseDurationMs: 60_000,
      enforceRegisteredWorkerCapacity: true,
    });
    expect(browserAssignment).toMatchObject({
      executionId: created.executionId,
      stepKind: ExecutionStepKind.TOOL,
      work: {
        taskType: 'browser.read_current_page',
        toolPlan: {
          operationId: plan.operationId,
          toolCallId,
          normalizedArguments: {
            expectedUrl: 'https://example.test/harness',
            maxChars: 12_000,
          },
        },
      },
    });
    await attemptService.startAttempt(browserAssignment!.attemptId, browserId);

    const pageArtifactId = randomUUID();
    const pageArtifactRole = `browser_page:${toolCallId}`;
    const pageBody = Buffer.from(
      JSON.stringify({
        url: 'https://example.test/harness',
        text: 'The harness plan is ready.',
        truncated: false,
      }),
    );
    await attemptService.uploadOutputArtifact(
      browserAssignment!.attemptId,
      browserId,
      {
        artifactId: pageArtifactId,
        kind: 'browser-page-snapshot',
        contentHash: contentHash(pageBody),
        size: pageBody.length,
        mediaType: 'application/json',
        encoding: 'identity',
        dataClassification: 'workspace',
        redaction: { applied: false },
        retentionClass: 'operational',
        inputSourceIds: [],
        bodyBase64: pageBody.toString('base64'),
      },
    );
    await attemptService.receiveResult({
      executionId: browserAssignment!.executionId,
      stepId: browserAssignment!.stepId,
      operationId: browserAssignment!.operationId,
      attemptId: browserAssignment!.attemptId,
      workerId: browserId,
      result: {
        schemaVersion: 'step-result/1',
        executionId: browserAssignment!.executionId,
        stepId: browserAssignment!.stepId,
        operationId: browserAssignment!.operationId,
        attemptId: browserAssignment!.attemptId,
        stepKind: ExecutionStepKind.TOOL,
        status: 'succeeded',
        runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
        output: {
          kind: ExecutionStepKind.TOOL,
          toolResult: {
            schemaVersion: 'tool-result/1',
            operationId: plan.operationId,
            toolCallId,
            status: 'succeeded',
            content: '',
            structuredContent: {
              url: 'https://example.test/harness',
              truncated: false,
              contentArtifactId: pageArtifactId,
              contentHash: contentHash(pageBody),
              size: pageBody.length,
            },
            artifactRefs: [
              { role: pageArtifactRole, artifactId: pageArtifactId },
            ],
            sourceRefs: [],
            effects: [],
            error: null,
          },
        },
        artifactRefs: [{ role: pageArtifactRole, artifactId: pageArtifactId }],
        error: null,
      },
    });
    await expect(attemptService.processReceivedResults()).resolves.toBe(1);
    await expect(
      dataSource.getRepository(ExecutionEventEntity).findOneByOrFail({
        eventType: 'operation.finished',
        operationId: plan.operationId,
      }),
    ).resolves.toMatchObject({
      envelope: {
        artifactRefs: [pageArtifactId],
      },
    });
    await expect(
      agentLoopService.materializeReadyToolContinuations(),
    ).resolves.toBe(1);

    const source = await dataSource
      .getRepository(ExecutionStepEntity)
      .findOneByOrFail({ stepId: assignment!.stepId });
    expect(source.continuationStepId).toEqual(expect.any(String));
    await expect(
      dataSource
        .getRepository(ExecutionStepEntity)
        .findOneByOrFail({ stepId: source.continuationStepId! }),
    ).resolves.toMatchObject({
      status: ExecutionStepStatus.READY,
      stepKind: ExecutionStepKind.INFERENCE,
      budgetReservationId: null,
      inputArtifactRefs: expect.arrayContaining([
        { role: pageArtifactRole, artifactId: pageArtifactId },
        {
          role: 'active_context',
          artifactId: expect.any(String),
        },
      ]),
      work: {
        taskType: 'assistant-chat',
        agentName: 'assistant',
        payload: {
          toolHistory: [
            {
              round: 1,
              calls: [{ toolCallId, name: 'browser.read_current_page' }],
              results: [
                {
                  toolCallId,
                  status: 'succeeded',
                  structuredContent: {
                    url: 'https://example.test/harness',
                    truncated: false,
                    contentArtifactId: pageArtifactId,
                    contentHash: contentHash(pageBody),
                    size: pageBody.length,
                  },
                  artifactRefs: [
                    { role: pageArtifactRole, artifactId: pageArtifactId },
                  ],
                },
              ],
            },
          ],
        },
      },
    });
    const continuationStep = await dataSource
      .getRepository(ExecutionStepEntity)
      .findOneByOrFail({ stepId: source.continuationStepId! });
    const contextRefs = continuationStep.inputArtifactRefs.filter(
      (ref) => ref.role === 'active_context',
    );
    expect(contextRefs).toHaveLength(1);
    const continuationContext = await dataSource
      .getRepository(ExecutionArtifactEntity)
      .createQueryBuilder('artifact')
      .addSelect('artifact.body')
      .where('artifact.artifactId = :artifactId', {
        artifactId: contextRefs[0].artifactId,
      })
      .getOneOrFail();
    const continuationSnapshot = JSON.parse(
      continuationContext.body!.toString(),
    );
    expect(continuationSnapshot.sourceConversation.revision).toBe(1);
    expect(continuationSnapshot.effectivePayload.toolHistory).toHaveLength(1);
    await expect(
      agentLoopService.materializeReadyToolContinuations(),
    ).resolves.toBe(0);
    await expect(agentLoopService.prepareReadyInferences()).resolves.toBe(1);
  });
}

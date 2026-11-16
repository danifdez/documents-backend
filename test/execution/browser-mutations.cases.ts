import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ExecutionStepEntity } from '../../src/execution/execution-step.entity';
import { ExecutionStepStatus } from '../../src/execution/execution-step-status.enum';
import { ExecutionStepKind } from '../../src/execution/execution-step-kind.enum';
import { StepAssignment } from '../../src/execution/execution-control-plane.types';
import { ExecutionOperationEntity } from '../../src/execution/execution-operation.entity';
import { ExecutionOperationStatus } from '../../src/execution/execution-operation-status.enum';
import type { ExecutionFixture } from './fixture';
import { TEST_RUNTIME_FINGERPRINT, TEST_CODE_FINGERPRINT } from './fixture';

interface BrowserMutationMatrixCase {
  toolName: string;
  descriptorVersion: string;
  capability: string;
  effectClass: 'external_reversible' | 'external_irreversible';
  target: string;
  arguments: Record<string, unknown>;
}

const BROWSER_MUTATION_MATRIX = JSON.parse(
  readFileSync(
    join(
      process.cwd(),
      'contracts/execution/v1/schemas/browser-mutation-matrix.schema.json',
    ),
    'utf8',
  ),
).properties.cases.const as BrowserMutationMatrixCase[];

export function registerBrowserMutationsCases(
  getContext: ExecutionFixture,
): void {
  it('runs every confirmed browser mutation through duplicate ACK and continuation', async () => {
    const {
      dataSource,
      service,
      attemptService,
      workerService,
      confirmationService,
      agentLoopService,
    } = getContext();

    const ownerPrincipal = 'browser-mutation-matrix-e2e';
    const browserId = randomUUID();
    const cases = BROWSER_MUTATION_MATRIX;
    expect(cases).toHaveLength(5);
    const registration = await workerService.enrollBrowser(
      browserId,
      'ia-browser-mutation-matrix-e2e',
      ownerPrincipal,
      { runtime: 'test' },
    );
    expect(registration.worker.capabilities).toEqual(
      expect.arrayContaining(cases.map((item) => item.capability)),
    );
    await dataSource.query(`
      INSERT INTO "agents" ("id", "name", "pinned", "owner_principal")
      SELECT id, 'Browser mutation agent ' || id, true, 'standalone'
      FROM generate_series(2, 5) AS id
      ON CONFLICT ("id") DO NOTHING
    `);

    const executions = await Promise.all(
      cases.map(
        async (item, index) =>
          (
            await service.createForChat(
              'agent_chat',
              `Execute ${item.toolName}`,
              { ownerPrincipal },
              {
                ownerId: index + 1,
                folderScope: null,
                systemPrompt: null,
              },
            )
          ).execution,
      ),
    );
    const byExecution = new Map(
      executions.map((execution, index) => [
        execution.executionId,
        { execution, item: cases[index], toolCallId: randomUUID() },
      ]),
    );
    await expect(agentLoopService.prepareReadyInferences(20)).resolves.toBe(
      cases.length,
    );

    const sourceAssignments = new Map<string, StepAssignment>();
    for (let index = 0; index < cases.length; index += 1) {
      const workerId = randomUUID();
      const assignment = await attemptService.claimReadyStep({
        workerId,
        stepKinds: [ExecutionStepKind.INFERENCE],
        capabilities: ['agent-chat'],
        leaseDurationMs: 30_000,
      });
      expect(assignment).not.toBeNull();
      const matrixCase = byExecution.get(assignment!.executionId)!;
      sourceAssignments.set(assignment!.executionId, assignment!);
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
          codeFingerprint: TEST_CODE_FINGERPRINT,
          runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
          output: {
            kind: ExecutionStepKind.INFERENCE,
            outcome: {
              kind: 'tool_requests',
              calls: [
                {
                  toolCallId: matrixCase.toolCallId,
                  name: matrixCase.item.toolName,
                  arguments: matrixCase.item.arguments,
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
    }
    await expect(attemptService.processReceivedResults(20)).resolves.toBe(
      cases.length,
    );
    await expect(
      agentLoopService.materializeAcceptedToolRequests(20),
    ).resolves.toBe(0);

    const pending = await confirmationService.listPending({ ownerPrincipal });
    expect(pending).toHaveLength(cases.length);
    for (const confirmation of pending) {
      await confirmationService.decide(
        confirmation.confirmation.confirmationId,
        'approved',
        { ownerPrincipal },
      );
    }
    await expect(
      agentLoopService.materializeAcceptedToolRequests(20),
    ).resolves.toBe(cases.length);

    for (let index = 0; index < cases.length; index += 1) {
      const assignment = await attemptService.claimReadyStep({
        workerId: browserId,
        ownerPrincipal,
        stepKinds: [ExecutionStepKind.TOOL],
        capabilities: cases.map((item) => item.capability),
        leaseDurationMs: 60_000,
        enforceRegisteredWorkerCapacity: true,
      });
      expect(assignment).not.toBeNull();
      const matrixCase = byExecution.get(assignment!.executionId)!;
      const plan = assignment!.work.toolPlan as any;
      expect(assignment).toMatchObject({
        stepKind: ExecutionStepKind.TOOL,
        work: {
          taskType: matrixCase.item.toolName,
          confirmationDecision: { status: 'approved' },
          toolPlan: {
            toolCallId: matrixCase.toolCallId,
            toolName: matrixCase.item.toolName,
            descriptorVersion: matrixCase.item.descriptorVersion,
            normalizedArguments: matrixCase.item.arguments,
            recoveryClass: 'effect_checked',
            requiredCapabilities: [matrixCase.item.capability],
            effects: [
              {
                effectClass: matrixCase.item.effectClass,
                resourceKey: 'browser:active-page',
                verificationRequired: true,
              },
            ],
          },
        },
      });
      await attemptService.startAttempt(assignment!.attemptId, browserId);
      const result = {
        schemaVersion: 'step-result/1',
        executionId: assignment!.executionId,
        stepId: assignment!.stepId,
        operationId: assignment!.operationId,
        attemptId: assignment!.attemptId,
        stepKind: ExecutionStepKind.TOOL,
        status: 'succeeded',
        runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
        output: {
          kind: ExecutionStepKind.TOOL,
          toolResult: {
            schemaVersion: 'tool-result/1',
            operationId: assignment!.operationId,
            toolCallId: matrixCase.toolCallId,
            status: 'succeeded',
            content: '',
            structuredContent: {
              url: 'https://example.test/after',
              title: matrixCase.item.toolName,
            },
            artifactRefs: [],
            sourceRefs: [],
            effects: [
              {
                effectClass: matrixCase.item.effectClass,
                resourceKey: 'browser:active-page',
                status: 'applied',
              },
            ],
            error: null,
          },
        },
        artifactRefs: [],
        error: null,
      };
      await expect(
        attemptService.receiveResult({
          executionId: assignment!.executionId,
          stepId: assignment!.stepId,
          operationId: assignment!.operationId,
          attemptId: assignment!.attemptId,
          workerId: browserId,
          result,
        }),
      ).resolves.toMatchObject({ code: 'received' });
      await expect(
        attemptService.receiveResult({
          executionId: assignment!.executionId,
          stepId: assignment!.stepId,
          operationId: assignment!.operationId,
          attemptId: assignment!.attemptId,
          workerId: browserId,
          result,
        }),
      ).resolves.toMatchObject({ code: 'duplicate' });
      await expect(attemptService.processReceivedResults(1)).resolves.toBe(1);
      await expect(
        dataSource
          .getRepository(ExecutionOperationEntity)
          .findOneByOrFail({ operationId: plan.operationId }),
      ).resolves.toMatchObject({
        status: ExecutionOperationStatus.SUCCEEDED,
        result: {
          toolCallId: matrixCase.toolCallId,
          status: 'succeeded',
          effects: [
            {
              effectClass: matrixCase.item.effectClass,
              resourceKey: 'browser:active-page',
              status: 'applied',
            },
          ],
        },
      });
    }

    await expect(
      agentLoopService.materializeReadyToolContinuations(20),
    ).resolves.toBe(cases.length);
    for (const [executionId, matrixCase] of byExecution) {
      const source = await dataSource
        .getRepository(ExecutionStepEntity)
        .findOneByOrFail({
          stepId: sourceAssignments.get(executionId)!.stepId,
        });
      const continuation = await dataSource
        .getRepository(ExecutionStepEntity)
        .findOneByOrFail({ stepId: source.continuationStepId! });
      expect(continuation).toMatchObject({
        status: ExecutionStepStatus.READY,
        stepKind: ExecutionStepKind.INFERENCE,
        work: {
          payload: {
            toolHistory: [
              {
                calls: [
                  {
                    toolCallId: matrixCase.toolCallId,
                    name: matrixCase.item.toolName,
                  },
                ],
                results: [
                  {
                    toolCallId: matrixCase.toolCallId,
                    status: 'succeeded',
                    effects: [
                      {
                        effectClass: matrixCase.item.effectClass,
                        resourceKey: 'browser:active-page',
                        status: 'applied',
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      });
    }
  });
}

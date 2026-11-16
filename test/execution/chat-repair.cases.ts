import { randomUUID } from 'crypto';
import { ExecutionEntity } from '../../src/execution/execution.entity';
import { ExecutionStepEntity } from '../../src/execution/execution-step.entity';
import { ExecutionStepKind } from '../../src/execution/execution-step-kind.enum';
import { ExecutionStatus } from '../../src/execution/execution-status.enum';
import type { ExecutionFixture } from './fixture';
import { TEST_RUNTIME_FINGERPRINT, TEST_CODE_FINGERPRINT } from './fixture';

export function registerChatRepairCases(getContext: ExecutionFixture): void {
  it('repairs invalid chat output and fails without a confirmed value', async () => {
    const {
      dataSource,
      attemptService,
      agentLoopService,
      terminalCandidateService,
      createChat,
    } = getContext();

    const created = await createChat(
      'assistant_chat',
      'Produce a valid final answer',
      { ownerPrincipal: 'invalid-outcome-e2e' },
      { ownerId: 1 },
    );
    const workerId = randomUUID();
    const completeInvalidInference = async () => {
      await expect(agentLoopService.prepareReadyInferences()).resolves.toBe(1);
      const assignment = await attemptService.claimReadyStep({
        workerId,
        stepKinds: [ExecutionStepKind.INFERENCE],
        capabilities: ['assistant-chat'],
        leaseDurationMs: 30_000,
      });
      expect(assignment).not.toBeNull();
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
              kind: 'invalid',
              reason: 'empty_model_response',
            },
          },
          usage: {
            promptTokens: 10,
            completionTokens: 0,
            totalTokens: 10,
          },
          inference: {
            effectiveModel: 'e2e-model',
            effectiveAdapter: null,
            effectivePromptPackages: ['e2e-prompt'],
            finishReason: 'completed',
            inferenceMs: 1,
            cacheOutcome: 'miss',
            warnings: [],
          },
          artifactRefs: [],
          error: null,
        },
      });
      await expect(attemptService.processReceivedResults()).resolves.toBe(1);
      return assignment!;
    };

    const initial = await completeInvalidInference();
    await expect(terminalCandidateService.promoteReady()).resolves.toBe(0);
    await expect(agentLoopService.materializeInvalidOutcomes()).resolves.toBe(
      1,
    );
    const initialSource = await dataSource
      .getRepository(ExecutionStepEntity)
      .findOneByOrFail({ stepId: initial.stepId });
    const repair = await dataSource
      .getRepository(ExecutionStepEntity)
      .findOneByOrFail({ stepId: initialSource.continuationStepId! });
    expect(repair.work).toMatchObject({
      agentLoop: {
        purpose: 'repair',
        phase: 'output_repair',
        sourceStepId: initial.stepId,
      },
      payload: {
        runtimeDirective: {
          kind: 'output_repair',
          reason: 'empty_model_response',
          toolsAllowed: false,
        },
        activeCapabilities: { tools: [] },
      },
    });

    const repairAssignment = await completeInvalidInference();
    expect(repairAssignment.stepId).toBe(repair.stepId);
    await expect(agentLoopService.materializeInvalidOutcomes()).resolves.toBe(
      1,
    );
    const repairedSource = await dataSource
      .getRepository(ExecutionStepEntity)
      .findOneByOrFail({ stepId: repair.stepId });
    const closing = await dataSource
      .getRepository(ExecutionStepEntity)
      .findOneByOrFail({ stepId: repairedSource.continuationStepId! });
    expect(closing.work).toMatchObject({
      agentLoop: {
        purpose: 'closing',
        phase: 'forced_finalization',
        sourceStepId: repair.stepId,
      },
      payload: {
        runtimeDirective: {
          kind: 'forced_finalization',
          toolsAllowed: false,
        },
        activeCapabilities: { tools: [] },
      },
    });

    const closingAssignment = await completeInvalidInference();
    expect(closingAssignment.stepId).toBe(closing.stepId);
    await expect(agentLoopService.materializeInvalidOutcomes()).resolves.toBe(
      1,
    );
    await expect(
      dataSource
        .getRepository(ExecutionEntity)
        .findOneByOrFail({ executionId: created.executionId }),
    ).resolves.toMatchObject({
      status: ExecutionStatus.RUNNING,
      phase: 'terminal_pending_failed',
      error: { code: 'terminal_candidate_unavailable' },
    });
  });
}

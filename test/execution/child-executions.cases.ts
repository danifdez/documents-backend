import { randomUUID } from 'crypto';
import { ExecutionContractValidator } from '../../src/execution/execution-contract-validator';
import { ExecutionEntity } from '../../src/execution/execution.entity';
import { ExecutionStepEntity } from '../../src/execution/execution-step.entity';
import { ExecutionStepStatus } from '../../src/execution/execution-step-status.enum';
import { ExecutionStepKind } from '../../src/execution/execution-step-kind.enum';
import { canonicalHash } from '../../src/execution/execution.service';
import { ExecutionToolRuntimeService } from '../../src/execution-coordinator/execution-tool-runtime.service';
import type { ExecutionFixture } from './fixture';
import { TEST_RUNTIME_FINGERPRINT, TEST_CODE_FINGERPRINT } from './fixture';

export function registerChildExecutionsCases(
  getContext: ExecutionFixture,
): void {
  it('creates, joins and incorporates a bounded durable child execution', async () => {
    const {
      dataSource,
      service,
      budgets,
      attemptService,
      toolPlanService,
      agentLoopService,
      effectJournalService,
      createChat,
    } = getContext();

    const created = await createChat(
      'assistant_chat',
      'Delegate a focused comparison',
      { ownerPrincipal: 'delegation-e2e' },
      { ownerId: 1, conversation: [] },
    );
    const initialStep = await dataSource
      .getRepository(ExecutionStepEntity)
      .findOneByOrFail({ executionId: created.executionId });
    initialStep.status = ExecutionStepStatus.COMPLETED;
    await dataSource.getRepository(ExecutionStepEntity).save(initialStep);
    const { grant } = await budgets.requestProgressGrant(created.executionId, {
      executionId: created.executionId,
      turnId: created.turnId!,
      loopId: created.executionId,
      agentName: 'assistant',
      loopKind: 'top_level',
      requestedPolicy: {
        normal: 3,
        normalInferenceSoftLimit: 2,
        repair: 1,
        closing: 1,
        maxTokensPerInference: 512,
        toolCalls: 3,
        toolCallSoftLimit: 2,
        exactToolRepeatWarning: false,
        exactToolRepeatBlockAfterWarning: false,
        exactToolRepeatTerminateAfterBlock: false,
      },
    });
    const toolCallId = randomUUID();
    const prepared = await toolPlanService.prepare({
      schemaVersion: 'tool-invocation/1',
      toolCallId,
      name: 'agents.delegate',
      arguments: { goal: 'Compare evidence A with evidence B' },
      requester: { kind: 'deterministic', component: 'documents-backend' },
      executionContext: {
        executionId: created.executionId,
        turnId: created.turnId!,
        causedByEventId: created.lastEventId!,
        phase: 'agent_loop',
        dataClassification: 'workspace',
      },
    });
    const reservation = await budgets.reserveOperationBudget(
      created.executionId,
      {
        executionId: created.executionId,
        loopId: created.executionId,
        grantId: grant.grantId,
        operationId: prepared.plan.operationId,
        operationKind: 'tool_call',
        bucket: 'tool',
        toolCallId,
        operationFingerprint: canonicalHash({
          name: 'agents.delegate',
          arguments: { goal: 'Compare evidence A with evidence B' },
        }),
        operationFingerprintVersion: 'canonical_tool_input_v1',
        toolBatchSize: 1,
        toolBatchIndex: 0,
        phase: 'agent_loop',
        round: 1,
        name: 'agents.delegate',
      },
    );
    const parentToolStep = await toolPlanService.materialize(
      toolCallId,
      reservation.reservation.reservationId,
    );
    expect(parentToolStep).toMatchObject({
      status: ExecutionStepStatus.BLOCKED,
      work: {
        taskType: 'agents.delegate',
        joinPolicy: 'all',
        delegationDepth: 1,
      },
    });
    const childExecutionId = String(parentToolStep!.work.childExecutionId);
    const child = await dataSource
      .getRepository(ExecutionEntity)
      .findOneByOrFail({ executionId: childExecutionId });
    expect(child).toMatchObject({
      rootExecutionId: created.executionId,
      parentExecutionId: created.executionId,
      taskType: 'delegated-agent',
      turnId: created.turnId,
      payload: {
        delegationOperationId: prepared.plan.operationId,
        joinPolicy: 'all',
        depth: 1,
      },
    });
    const childStepId = String(parentToolStep!.work.childStepId);
    await expect(agentLoopService.prepareReadyInferences(1)).resolves.toBe(1);
    const workerId = randomUUID();
    const assignment = await attemptService.claimReadyStep({
      workerId,
      stepKinds: [ExecutionStepKind.INFERENCE],
      capabilities: ['assistant-chat'],
      leaseDurationMs: 30_000,
    });
    expect(assignment).toMatchObject({
      executionId: childExecutionId,
      stepId: childStepId,
      work: {
        taskType: 'assistant-chat',
        agentName: 'subagent',
        payload: { delegationMode: true },
      },
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
        codeFingerprint: TEST_CODE_FINGERPRINT,
        runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
        output: {
          kind: ExecutionStepKind.INFERENCE,
          outcome: {
            kind: 'final_text',
            text: 'Independent comparison',
          },
        },
        usage: {
          promptTokens: 8,
          completionTokens: 4,
          totalTokens: 12,
        },
        inference: {
          effectiveModel: 'e2e-model',
          effectiveAdapter: null,
          effectivePromptPackages: ['e2e-prompt'],
          finishReason: 'stop',
          inferenceMs: 1,
          cacheOutcome: 'miss',
          warnings: [],
        },
        artifactRefs: [],
        error: null,
      },
    });
    await expect(attemptService.processReceivedResults(1)).resolves.toBe(1);
    await expect(
      dataSource
        .getRepository(ExecutionStepEntity)
        .findOneByOrFail({ stepId: parentToolStep!.stepId }),
    ).resolves.toMatchObject({ status: ExecutionStepStatus.BLOCKED });
    await service.completeExecution(
      childExecutionId,
      'Independent comparison',
      null,
      undefined,
      {
        socketEvent: 'executionDelegationCompleted',
        payload: { executionId: childExecutionId },
      },
    );
    await expect(agentLoopService.releaseTerminalDelegations(1)).resolves.toBe(
      1,
    );

    const runtime = new ExecutionToolRuntimeService(
      attemptService,
      new ExecutionContractValidator(),
      { globalSearch: async () => [] },
      {
        createFromExecution: async () => {
          throw new Error('unexpected_user_task_creation');
        },
        findByExecutionOperation: async () => null,
      },
      {} as any,
      service,
      effectJournalService,
    );
    await expect(runtime.executeReady(1)).resolves.toBe(1);
    await expect(attemptService.processReceivedResults(1)).resolves.toBe(1);
    await expect(
      dataSource
        .getRepository(ExecutionStepEntity)
        .findOneByOrFail({ stepId: parentToolStep!.stepId }),
    ).resolves.toMatchObject({
      status: ExecutionStepStatus.COMPLETED,
      result: {
        toolResult: {
          status: 'succeeded',
          content: 'Independent comparison',
          structuredContent: {
            childExecutionId,
            childStatus: 'completed',
            joinPolicy: 'all',
          },
        },
      },
    });
  });
}

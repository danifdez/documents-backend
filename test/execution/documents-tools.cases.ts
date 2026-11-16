import { randomUUID } from 'crypto';
import { ExecutionContractValidator } from '../../src/execution/execution-contract-validator';
import { ExecutionEventEntity } from '../../src/execution/execution-event.entity';
import { ExecutionEntity } from '../../src/execution/execution.entity';
import { ExecutionStepEntity } from '../../src/execution/execution-step.entity';
import { ExecutionStepStatus } from '../../src/execution/execution-step-status.enum';
import { ExecutionOperationEntity } from '../../src/execution/execution-operation.entity';
import { ExecutionOperationStatus } from '../../src/execution/execution-operation-status.enum';
import { ExecutionToolRuntimeService } from '../../src/execution-coordinator/execution-tool-runtime.service';
import {
  assertOperationBudgetProjection,
  governedBudgetStart,
} from '../../src/execution/inference-budget-policy';
import {
  exactToolRepeatGuardSnapshot,
  ProgressEvent,
  projectExecutionProgress,
} from '../../src/execution/execution-progress';
import type { ExecutionFixture } from './fixture';

export function registerDocumentsToolsCases(
  getContext: ExecutionFixture,
): void {
  it('executes documents.search and accepts its canonical ToolResult', async () => {
    const {
      dataSource,
      service,
      budgets,
      attemptService,
      toolPlanService,
      effectJournalService,
      activateStepAttempt,
      createChat,
    } = getContext();

    const created = await createChat(
      'assistant_chat',
      'Find the harness plan',
      { ownerPrincipal: 'tool-e2e' },
      {},
    );
    const sourceAttemptId = randomUUID();
    await activateStepAttempt(created.executionId, sourceAttemptId);
    const prepared = await toolPlanService.prepare({
      schemaVersion: 'tool-invocation/1',
      toolCallId: randomUUID(),
      name: 'documents.search',
      arguments: { query: 'harness', limit: 2 },
      requester: {
        kind: 'deterministic',
        component: 'documents-backend',
      },
      executionContext: {
        executionId: created.executionId,
        turnId: created.turnId!,
        causedByEventId: created.lastEventId!,
        phase: 'agent_loop',
        dataClassification: 'workspace',
      },
    });
    const { grant } = await budgets.requestProgressGrant(created.executionId, {
      executionId: created.executionId,
      turnId: created.turnId!,
      loopId: created.executionId,
      agentName: 'assistant',
      loopKind: 'top_level',
      requestedPolicy: {
        normal: 1,
        normalInferenceSoftLimit: 1,
        repair: 0,
        closing: 0,
        maxTokensPerInference: 128,
        toolCalls: 1,
        toolCallSoftLimit: 1,
        exactToolRepeatWarning: false,
        exactToolRepeatBlockAfterWarning: false,
        exactToolRepeatTerminateAfterBlock: false,
      },
    });
    const reserved = await budgets.reserveOperationBudget(created.executionId, {
      executionId: created.executionId,
      loopId: created.executionId,
      grantId: grant.grantId,
      operationId: prepared.plan.operationId,
      operationKind: 'tool_call',
      bucket: 'tool',
      toolCallId: prepared.plan.toolCallId,
      phase: 'agent_loop',
      round: 1,
      name: 'documents.search',
    });
    const step = await toolPlanService.materialize(
      prepared.plan.toolCallId,
      reserved.reservation.reservationId,
    );
    const runtime = new ExecutionToolRuntimeService(
      attemptService,
      new ExecutionContractValidator(),
      {
        globalSearch: async () => [
          {
            id: 17,
            name: 'Harness implementation plan',
            score: 0.95,
            collection: 'docs',
          },
        ],
      },
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

    await expect(runtime.executeReady()).resolves.toBe(1);
    await expect(attemptService.processReceivedResults()).resolves.toBe(1);

    await expect(
      dataSource.getRepository(ExecutionStepEntity).findOneByOrFail({
        stepId: step.stepId,
      }),
    ).resolves.toMatchObject({
      status: ExecutionStepStatus.COMPLETED,
      result: {
        kind: 'tool',
        toolResult: {
          operationId: prepared.plan.operationId,
          toolCallId: prepared.plan.toolCallId,
          status: 'succeeded',
          structuredContent: { count: 1 },
          effects: [],
          error: null,
        },
      },
    });
    await expect(
      dataSource.getRepository(ExecutionOperationEntity).findOneByOrFail({
        operationId: prepared.plan.operationId,
      }),
    ).resolves.toMatchObject({
      status: ExecutionOperationStatus.SUCCEEDED,
      result: {
        schemaVersion: 'tool-result/1',
        operationId: prepared.plan.operationId,
        toolCallId: prepared.plan.toolCallId,
        status: 'succeeded',
      },
    });
    const persistedExecution = await dataSource
      .getRepository(ExecutionEntity)
      .findOneByOrFail({ executionId: created.executionId });
    expect(
      persistedExecution.progressLedger.operationBudget?.reservations[
        prepared.plan.operationId
      ],
    ).toMatchObject({
      reservationId: reserved.reservation.reservationId,
      status: 'consumed',
    });
    const operationEvents = await dataSource
      .getRepository(ExecutionEventEntity)
      .find({
        where: {
          rootExecutionId: created.rootExecutionId,
          operationId: prepared.plan.operationId,
        },
        order: { sequence: 'ASC' },
      });
    expect(operationEvents.map((event) => event.eventType)).toEqual([
      'operation.started',
      'operation.finished',
    ]);
    const [started, finished] = operationEvents;
    expect(started.attemptId).toEqual(expect.any(String));
    expect(started.envelope).toMatchObject({
      stepId: step.stepId,
      operationId: prepared.plan.operationId,
      toolCallId: prepared.plan.toolCallId,
      attemptId: started.attemptId,
      payload: {
        operationKind: 'tool_call',
        status: 'dispatched',
        name: 'documents.search',
        loopId: created.executionId,
        loopKind: 'top_level',
        round: 1,
        phase: 'agent_loop',
        budgetGrantId: grant.grantId,
        budgetReservationId: reserved.reservation.reservationId,
        budgetBucket: 'tool',
      },
    });
    expect(finished).toMatchObject({
      attemptId: started.attemptId,
      causedByEventId: started.eventId,
    });
    expect(finished.envelope).toMatchObject({
      stepId: step.stepId,
      operationId: prepared.plan.operationId,
      toolCallId: prepared.plan.toolCallId,
      attemptId: started.attemptId,
      payload: {
        operationKind: 'tool_call',
        status: 'succeeded',
        result: {
          schemaVersion: 'tool-result/1',
          operationId: prepared.plan.operationId,
          toolCallId: prepared.plan.toolCallId,
          status: 'succeeded',
        },
        error: null,
      },
    });
    const eventsBeforeStart = await dataSource
      .getRepository(ExecutionEventEntity)
      .find({
        where: { rootExecutionId: created.rootExecutionId },
        order: { sequence: 'ASC' },
      });
    const budgetStateBeforeStart = projectExecutionProgress(
      eventsBeforeStart
        .filter((event) => Number(event.sequence) < Number(started.sequence))
        .map((event) => event.envelope as unknown as ProgressEvent),
    );
    const governedStart = governedBudgetStart(
      persistedExecution,
      started.envelope,
    );
    expect(governedStart).not.toBeNull();
    expect(() =>
      assertOperationBudgetProjection(
        governedStart!,
        budgetStateBeforeStart.ledger.operationBudget,
        exactToolRepeatGuardSnapshot(
          budgetStateBeforeStart.ledger,
          grant.grantId,
        ),
      ),
    ).not.toThrow();
  });
}

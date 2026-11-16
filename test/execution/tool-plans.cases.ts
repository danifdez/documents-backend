import { randomUUID } from 'crypto';
import { ExecutionEventEntity } from '../../src/execution/execution-event.entity';
import { ExecutionEntity } from '../../src/execution/execution.entity';
import { ExecutionStepEntity } from '../../src/execution/execution-step.entity';
import { ExecutionPriority } from '../../src/execution/execution-priority.enum';
import { ExecutionStatus } from '../../src/execution/execution-status.enum';
import { ExecutionOutboxEntity } from '../../src/execution-outbox/execution-outbox.entity';
import { ExecutionToolPlanEntity } from '../../src/execution/execution-tool-plan.entity';
import { ExecutionConfirmationEntity } from '../../src/execution/execution-confirmation.entity';
import type { ExecutionFixture } from './fixture';

export function registerToolPlansCases(getContext: ExecutionFixture): void {
  it('prepares a durable tool plan without creating executable work', async () => {
    const { dataSource, service, toolPlanService, activeCapabilities } =
      getContext();

    const created = await service.create(
      'assistant-chat',
      ExecutionPriority.NORMAL,
      {
        ownerId: 1,
        activeCapabilities: activeCapabilities('documents.search'),
      },
    );
    const stepsBefore = await dataSource
      .getRepository(ExecutionStepEntity)
      .countBy({ executionId: created.executionId });
    const toolCallId = randomUUID();
    const request = {
      schemaVersion: 'tool-invocation/1' as const,
      toolCallId,
      name: 'documents.search',
      arguments: { query: '  harness  ', limit: 5 },
      requester: {
        kind: 'deterministic' as const,
        component: 'documents-backend',
      },
      executionContext: {
        executionId: created.executionId,
        causedByEventId: created.lastEventId!,
        phase: 'tool',
        dataClassification: 'workspace' as const,
      },
    };

    const prepared = await toolPlanService.prepare(request);
    const repeated = await toolPlanService.prepare(request);

    expect(prepared.duplicate).toBe(false);
    expect(repeated).toMatchObject({
      duplicate: true,
      plan: { operationId: prepared.plan.operationId, stepId: null },
    });
    await expect(
      dataSource.getRepository(ExecutionStepEntity).countBy({
        executionId: created.executionId,
      }),
    ).resolves.toBe(stepsBefore);
    await expect(
      dataSource.getRepository(ExecutionToolPlanEntity).findOneByOrFail({
        toolCallId,
      }),
    ).resolves.toMatchObject({
      operationId: prepared.plan.operationId,
      schemaVersion: 'tool-plan/1',
      stepId: null,
      plan: {
        normalizedArguments: { query: 'harness', limit: 5 },
        policyDecision: { decision: 'allowed', rule: 'local_documents_read' },
      },
    });
  });

  it('persists, publishes and decides a confirmation tied to the exact tool plan', async () => {
    const {
      dataSource,
      service,
      toolPlanService,
      confirmationService,
      activeCapabilities,
    } = getContext();

    const ownerPrincipal = 'confirmation-e2e';
    const created = await service.create(
      'assistant-chat',
      ExecutionPriority.NORMAL,
      {
        ownerId: 42,
        activeCapabilities: activeCapabilities('user_tasks.create'),
      },
      { ownerPrincipal },
    );
    const toolCallId = randomUUID();
    const prepared = await toolPlanService.prepare({
      schemaVersion: 'tool-invocation/1',
      toolCallId,
      name: 'user_tasks.create',
      arguments: { title: 'Review harness evidence', description: 'E2E' },
      requester: {
        kind: 'deterministic',
        component: 'documents-backend',
      },
      executionContext: {
        executionId: created.executionId,
        causedByEventId: created.lastEventId!,
        phase: 'agent_loop',
        dataClassification: 'workspace',
      },
    });

    expect(prepared.plan.plan.policyDecision.decision).toBe(
      'confirmation_required',
    );
    await expect(
      toolPlanService.materialize(toolCallId, randomUUID()),
    ).resolves.toBeNull();
    await expect(
      confirmationService.activatePending(created.executionId),
    ).resolves.toBe(1);

    const waiting = await dataSource
      .getRepository(ExecutionEntity)
      .findOneByOrFail({ executionId: created.executionId });
    expect(waiting).toMatchObject({
      status: ExecutionStatus.WAITING,
      phase: 'awaiting_confirmation',
      waitReason: 'confirmation',
      resumePhase: 'coordination_pending',
    });
    const pending = await confirmationService.listPending({ ownerPrincipal });
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      ownerId: 42,
      taskType: 'assistant-chat',
      confirmation: {
        operationId: prepared.plan.operationId,
        toolCallId,
        planHash: prepared.plan.planHash,
        status: 'pending',
      },
    });

    const decided = await confirmationService.decide(
      pending[0].confirmation.confirmationId,
      'approved',
      { ownerPrincipal },
    );
    expect(decided).toMatchObject({
      planHash: prepared.plan.planHash,
      status: 'approved',
    });
    const resumed = await dataSource
      .getRepository(ExecutionEntity)
      .findOneByOrFail({ executionId: created.executionId });
    expect(resumed).toMatchObject({
      status: ExecutionStatus.QUEUED,
      phase: 'coordination_pending',
      waitReason: null,
      waitCondition: null,
      resumePhase: null,
      waitExpiresAt: null,
    });
    const events = await dataSource.getRepository(ExecutionEventEntity).find({
      where: { executionId: created.executionId },
      order: { sequence: 'ASC' },
    });
    expect(events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        'confirmation.requested',
        'confirmation.decided',
      ]),
    );
    const publications = await dataSource
      .getRepository(ExecutionOutboxEntity)
      .find({ where: { executionId: created.executionId } });
    expect(publications.map((publication) => publication.socketEvent)).toEqual(
      expect.arrayContaining([
        'executionConfirmationRequested',
        'executionConfirmationDecided',
      ]),
    );
  });

  it('expires a requested confirmation and resumes it as not executable', async () => {
    const {
      dataSource,
      service,
      toolPlanService,
      confirmationService,
      activeCapabilities,
    } = getContext();

    const ownerPrincipal = 'confirmation-expiry-e2e';
    const created = await service.create(
      'assistant-chat',
      ExecutionPriority.NORMAL,
      { activeCapabilities: activeCapabilities('user_tasks.create') },
      { ownerPrincipal },
    );
    const prepared = await toolPlanService.prepare({
      schemaVersion: 'tool-invocation/1',
      toolCallId: randomUUID(),
      name: 'user_tasks.create',
      arguments: { title: 'Expired task' },
      requester: {
        kind: 'deterministic',
        component: 'documents-backend',
      },
      executionContext: {
        executionId: created.executionId,
        causedByEventId: created.lastEventId!,
        phase: 'agent_loop',
        dataClassification: 'workspace',
      },
    });
    await confirmationService.activatePending(created.executionId);
    const repository = dataSource.getRepository(ExecutionConfirmationEntity);
    const confirmation = await repository.findOneByOrFail({
      operationId: prepared.plan.operationId,
    });
    confirmation.expiresAt = new Date(Date.now() - 1_000);
    await repository.save(confirmation);

    await expect(confirmationService.expirePending()).resolves.toBe(1);
    await expect(
      repository.findOneByOrFail({
        confirmationId: confirmation.confirmationId,
      }),
    ).resolves.toMatchObject({ status: 'expired', decidedBy: null });
    await expect(
      dataSource
        .getRepository(ExecutionEntity)
        .findOneByOrFail({ executionId: created.executionId }),
    ).resolves.toMatchObject({
      status: ExecutionStatus.QUEUED,
      phase: 'coordination_pending',
      waitReason: null,
    });
  });
}

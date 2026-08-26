import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager, In, LessThanOrEqual } from 'typeorm';
import {
  ExecutionOutboxEntity,
  ExecutionOutboxStatus,
} from '../execution-outbox/execution-outbox.entity';
import { canonicalHash } from './execution-canonical';
import { ExecutionConfirmationEntity } from './execution-confirmation.entity';
import {
  ExecutionConfirmationEnvelope,
  ExecutionConfirmationView,
} from './execution-confirmation.types';
import { ExecutionContractValidator } from './execution-contract-validator';
import { ExecutionEntity } from './execution.entity';
import { ExecutionEventEntity } from './execution-event.entity';
import {
  appendBackendExecutionEvent,
  nextBackendProducerSequence,
} from './execution-event.writer';
import { ExecutionStatus } from './execution-status.enum';
import { ExecutionToolPlanEntity } from './execution-tool-plan.entity';
import { ExecutionAccessScope } from './execution.types';

@Injectable()
export class ExecutionConfirmationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly contracts: ExecutionContractValidator,
  ) {}

  async createPending(
    manager: EntityManager,
    execution: ExecutionEntity,
    storedPlan: ExecutionToolPlanEntity,
  ): Promise<ExecutionConfirmationEntity | null> {
    const requirement = storedPlan.plan.confirmationRequirement;
    if (!requirement) return null;
    const expiresAt = requirement.expiresAt
      ? new Date(requirement.expiresAt)
      : null;
    const repository = manager.getRepository(ExecutionConfirmationEntity);
    return repository.save(
      repository.create({
        confirmationId: requirement.confirmationId,
        executionId: execution.executionId,
        operationId: storedPlan.operationId,
        ownerPrincipal: execution.ownerPrincipal,
        planHash: storedPlan.planHash,
        status: 'pending',
        decidedBy: null,
        decidedAt: null,
        expiresAt,
        requestedAt: null,
      }),
    );
  }

  async activatePending(executionId: string): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const executionRepo = manager.getRepository(ExecutionEntity);
      const execution = await executionRepo.findOne({
        where: { executionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!execution) throw new NotFoundException('execution_not_found');
      if (
        ![ExecutionStatus.QUEUED, ExecutionStatus.RUNNING].includes(
          execution.status,
        )
      ) {
        return 0;
      }
      const confirmations = await manager
        .getRepository(ExecutionConfirmationEntity)
        .find({
          where: { executionId, status: 'pending' },
          order: { createdAt: 'ASC' },
        });
      const unrequested = confirmations.filter((item) => !item.requestedAt);
      if (!confirmations.length) return 0;
      const plans = await manager.getRepository(ExecutionToolPlanEntity).find({
        where: {
          operationId: In(confirmations.map((item) => item.operationId)),
        },
      });
      const planByOperation = new Map(
        plans.map((plan) => [plan.operationId, plan]),
      );
      const root = await this.lockRoot(manager, execution);
      const rows = await manager.getRepository(ExecutionEventEntity).find({
        where: { rootExecutionId: root.rootExecutionId },
      });
      let producerSequence = nextBackendProducerSequence(rows);
      let sequence = Number(root.lastSequence);
      for (const confirmation of unrequested) {
        const plan = planByOperation.get(confirmation.operationId);
        if (!plan) throw new ConflictException('confirmation_plan_missing');
        const view = this.toView(confirmation, plan);
        this.contracts.assertConfirmation(
          view as unknown as Record<string, unknown>,
        );
        const event = await appendBackendExecutionEvent(
          manager,
          root,
          producerSequence++,
          {
            eventType: 'confirmation.requested',
            payloadSchema: 'confirmation.requested/1',
            payload: view as unknown as Record<string, unknown>,
            actor: { type: 'system' },
            executionId,
            turnId: execution.turnId,
            operationId: plan.operationId,
            toolCallId: plan.toolCallId,
            causedByEventId: root.lastEventId,
          },
          ++sequence,
        );
        await this.appendPublication(
          manager,
          execution,
          event.eventId,
          {
            confirmation: view,
            ownerId: execution.payload?.ownerId ?? null,
            taskType: execution.taskType,
          },
          'executionConfirmationRequested',
        );
        confirmation.requestedAt = new Date();
        await manager.save(confirmation);
        root.lastEventId = event.eventId;
      }
      const previousStatus = execution.status;
      const first = confirmations[0];
      const stateEvent = await appendBackendExecutionEvent(
        manager,
        root,
        producerSequence,
        {
          eventType: 'execution.state_changed',
          payloadSchema: 'execution.state_changed/1',
          payload: {
            from: previousStatus,
            to: ExecutionStatus.WAITING,
            phase: 'awaiting_confirmation',
            reason: 'confirmation_required',
          },
          actor: { type: 'system' },
          executionId,
          turnId: execution.turnId,
          causedByEventId: root.lastEventId,
        },
        ++sequence,
      );
      execution.status = ExecutionStatus.WAITING;
      execution.phase = 'awaiting_confirmation';
      execution.waitReason = 'confirmation';
      execution.waitCondition = {
        reason: 'confirmation',
        reference: first.confirmationId,
        resumePhase: 'agent_loop',
        ...(first.expiresAt
          ? { expiresAt: first.expiresAt.toISOString() }
          : {}),
      };
      execution.resumePhase = 'agent_loop';
      execution.waitExpiresAt = first.expiresAt;
      root.lastSequence = String(sequence);
      root.lastEventId = stateEvent.eventId;
      await executionRepo.save(root);
      if (root.executionId !== execution.executionId) {
        await executionRepo.save(execution);
      }
      return confirmations.length;
    });
  }

  async listPending(
    scope: ExecutionAccessScope,
  ): Promise<ExecutionConfirmationEnvelope[]> {
    const confirmations = await this.dataSource
      .getRepository(ExecutionConfirmationEntity)
      .find({
        where: { ownerPrincipal: scope.ownerPrincipal, status: 'pending' },
        order: { createdAt: 'ASC' },
      });
    const visible = confirmations.filter((item) => item.requestedAt !== null);
    if (!visible.length) return [];
    const plans = await this.dataSource
      .getRepository(ExecutionToolPlanEntity)
      .find({
        where: { operationId: In(visible.map((item) => item.operationId)) },
      });
    const byOperation = new Map(plans.map((plan) => [plan.operationId, plan]));
    const executions = await this.dataSource
      .getRepository(ExecutionEntity)
      .find({
        where: { executionId: In(visible.map((item) => item.executionId)) },
      });
    const byExecution = new Map(
      executions.map((execution) => [execution.executionId, execution]),
    );
    return visible.map((item) => {
      const plan = byOperation.get(item.operationId);
      if (!plan) throw new ConflictException('confirmation_plan_missing');
      const execution = byExecution.get(item.executionId);
      if (!execution)
        throw new ConflictException('confirmation_execution_missing');
      return {
        confirmation: this.toView(item, plan),
        ownerId:
          typeof execution.payload?.ownerId === 'number'
            ? execution.payload.ownerId
            : null,
        taskType: execution.taskType,
      };
    });
  }

  async decide(
    confirmationId: string,
    decision: 'approved' | 'denied',
    scope: ExecutionAccessScope,
  ): Promise<ExecutionConfirmationView> {
    return this.settle(confirmationId, decision, scope);
  }

  async expirePending(limit = 20): Promise<number> {
    const candidates = await this.dataSource
      .getRepository(ExecutionConfirmationEntity)
      .find({
        where: {
          status: 'pending',
          expiresAt: LessThanOrEqual(new Date()),
        },
        order: { expiresAt: 'ASC' },
        take: limit,
      });
    let expired = 0;
    for (const candidate of candidates) {
      if (!candidate.requestedAt) continue;
      await this.settle(candidate.confirmationId, 'expired', null);
      expired += 1;
    }
    return expired;
  }

  private async settle(
    confirmationId: string,
    requestedDecision: 'approved' | 'denied' | 'expired',
    scope: ExecutionAccessScope | null,
  ): Promise<ExecutionConfirmationView> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(ExecutionConfirmationEntity);
      const confirmation = await repository.findOne({
        where: { confirmationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !confirmation ||
        (scope && confirmation.ownerPrincipal !== scope.ownerPrincipal)
      ) {
        throw new NotFoundException('confirmation_not_found');
      }
      const plan = await manager
        .getRepository(ExecutionToolPlanEntity)
        .findOne({
          where: { operationId: confirmation.operationId },
          lock: { mode: 'pessimistic_write' },
        });
      if (!plan || canonicalHash(plan.plan) !== confirmation.planHash) {
        throw new ConflictException('confirmation_stale');
      }
      if (confirmation.status !== 'pending') {
        if (confirmation.status === requestedDecision) {
          return this.toView(confirmation, plan);
        }
        throw new ConflictException('confirmation_already_decided');
      }
      if (!confirmation.requestedAt) {
        throw new ConflictException('confirmation_not_requested');
      }
      const executionRepo = manager.getRepository(ExecutionEntity);
      const execution = await executionRepo.findOne({
        where: { executionId: confirmation.executionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !execution ||
        (scope && execution.ownerPrincipal !== scope.ownerPrincipal)
      ) {
        throw new NotFoundException('execution_not_found');
      }
      const now = new Date();
      const expired = this.isExpired(confirmation, plan, now);
      if (requestedDecision === 'expired' && !expired) {
        throw new ConflictException('confirmation_not_expired');
      }
      confirmation.status = expired ? 'expired' : requestedDecision;
      confirmation.decidedAt = now;
      confirmation.decidedBy = scope?.ownerPrincipal ?? null;
      await repository.save(confirmation);

      const root = await this.lockRoot(manager, execution);
      const rows = await manager.getRepository(ExecutionEventEntity).find({
        where: { rootExecutionId: root.rootExecutionId },
      });
      let producerSequence = nextBackendProducerSequence(rows);
      let sequence = Number(root.lastSequence);
      const decidedEvent = await appendBackendExecutionEvent(
        manager,
        root,
        producerSequence++,
        {
          eventType: 'confirmation.decided',
          payloadSchema: 'confirmation.decided/1',
          payload: {
            confirmationId,
            planHash: confirmation.planHash,
            decision: confirmation.status,
          },
          actor: scope
            ? { type: 'user', id: scope.ownerPrincipal }
            : { type: 'system' },
          executionId: execution.executionId,
          turnId: execution.turnId,
          operationId: plan.operationId,
          toolCallId: plan.toolCallId,
          causedByEventId: root.lastEventId,
        },
        ++sequence,
      );
      const previousStatus = execution.status;
      execution.status = ExecutionStatus.QUEUED;
      execution.phase = execution.resumePhase ?? 'agent_loop';
      execution.waitReason = null;
      execution.waitCondition = null;
      execution.resumePhase = null;
      execution.waitExpiresAt = null;
      const stateEvent = await appendBackendExecutionEvent(
        manager,
        root,
        producerSequence,
        {
          eventType: 'execution.state_changed',
          payloadSchema: 'execution.state_changed/1',
          payload: {
            from: previousStatus,
            to: ExecutionStatus.QUEUED,
            phase: execution.phase,
            reason: `confirmation_${confirmation.status}`,
          },
          actor: { type: 'system' },
          executionId: execution.executionId,
          turnId: execution.turnId,
          causedByEventId: decidedEvent.eventId,
        },
        ++sequence,
      );
      root.lastSequence = String(sequence);
      root.lastEventId = stateEvent.eventId;
      await executionRepo.save(root);
      if (root.executionId !== execution.executionId) {
        await executionRepo.save(execution);
      }
      const view = this.toView(confirmation, plan);
      await this.appendPublication(
        manager,
        execution,
        decidedEvent.eventId,
        {
          confirmation: view,
          ownerId: execution.payload?.ownerId ?? null,
          taskType: execution.taskType,
        },
        'executionConfirmationDecided',
      );
      return view;
    });
  }

  async decisionForPlan(
    manager: EntityManager,
    plan: ExecutionToolPlanEntity,
  ): Promise<ExecutionConfirmationEntity | null> {
    return manager.getRepository(ExecutionConfirmationEntity).findOneBy({
      operationId: plan.operationId,
    });
  }

  private toView(
    confirmation: ExecutionConfirmationEntity,
    plan: ExecutionToolPlanEntity,
  ): ExecutionConfirmationView {
    const requirement = plan.plan.confirmationRequirement;
    if (
      !requirement ||
      requirement.confirmationId !== confirmation.confirmationId
    ) {
      throw new ConflictException('confirmation_plan_mismatch');
    }
    return {
      schemaVersion: 'confirmation/1',
      confirmationId: confirmation.confirmationId,
      executionId: confirmation.executionId,
      operationId: confirmation.operationId,
      toolCallId: plan.toolCallId,
      planHash: confirmation.planHash,
      toolName: plan.toolName,
      reason: requirement.reason,
      prompt: requirement.prompt,
      scope: requirement.scope,
      resources: plan.plan.resources,
      effects: plan.plan.effects,
      status: confirmation.status,
      expiresAt: confirmation.expiresAt?.toISOString() ?? null,
      decidedAt: confirmation.decidedAt?.toISOString() ?? null,
    };
  }

  private isExpired(
    confirmation: ExecutionConfirmationEntity,
    plan: ExecutionToolPlanEntity,
    now: Date,
  ): boolean {
    const expiries = [
      confirmation.expiresAt,
      new Date(plan.plan.deadline),
      plan.plan.policyDecision.expiresAt
        ? new Date(plan.plan.policyDecision.expiresAt)
        : null,
    ].filter((value): value is Date => value !== null);
    return expiries.some((value) => value <= now);
  }

  private async lockRoot(
    manager: EntityManager,
    execution: ExecutionEntity,
  ): Promise<ExecutionEntity> {
    if (execution.executionId === execution.rootExecutionId) return execution;
    const root = await manager.getRepository(ExecutionEntity).findOne({
      where: { executionId: execution.rootExecutionId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!root) throw new NotFoundException('root_execution_not_found');
    return root;
  }

  private async appendPublication(
    manager: EntityManager,
    execution: ExecutionEntity,
    eventId: string,
    payload: Record<string, unknown>,
    socketEvent: string,
  ): Promise<void> {
    const repository = manager.getRepository(ExecutionOutboxEntity);
    await repository.save(
      repository.create({
        outboxId: randomUUID(),
        executionId: execution.executionId,
        eventId,
        schemaVersion: 'execution-outbox/1',
        socketEvent,
        payload,
        status: ExecutionOutboxStatus.PENDING,
        attempts: 0,
        availableAt: new Date(),
        leaseExpiresAt: null,
        publishedAt: null,
        lastError: null,
      }),
    );
  }
}

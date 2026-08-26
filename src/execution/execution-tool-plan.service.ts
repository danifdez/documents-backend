import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { ExecutionContractValidator } from './execution-contract-validator';
import { EXECUTION_UUID_PATTERN } from './execution.constants';
import { ExecutionEntity } from './execution.entity';
import { ExecutionEventEntity } from './execution-event.entity';
import { ExecutionOperationKind } from './execution-operation-kind.enum';
import { ExecutionOperationRecoveryClass } from './execution-operation-recovery-class.enum';
import { ExecutionStatus } from './execution-status.enum';
import { ExecutionStepAttemptEntity } from './execution-step-attempt.entity';
import { ExecutionStepAttemptStatus } from './execution-step-attempt-status.enum';
import { ExecutionStepEntity } from './execution-step.entity';
import { ExecutionStepKind } from './execution-step-kind.enum';
import { ExecutionStepStatus } from './execution-step-status.enum';
import { createExecutionStep } from './execution-step.service';
import { ExecutionToolInvocationEntity } from './execution-tool-invocation.entity';
import { ExecutionToolPlanEntity } from './execution-tool-plan.entity';
import {
  ToolInvocationContract,
  ToolPlanContract,
} from './execution-tool.types';
import { canonicalHash } from './execution-canonical';
import {
  AGENT_DELEGATE_TOOL_CAPABILITY,
  AGENT_DELEGATE_TOOL_NAME,
  AGENT_DELEGATE_TOOL_VERSION,
  DOCUMENT_SEARCH_TOOL_CAPABILITY,
  DOCUMENT_SEARCH_TOOL_NAME,
  DOCUMENT_SEARCH_TOOL_VERSION,
  USER_TASK_CREATE_TOOL_CAPABILITY,
  USER_TASK_CREATE_TOOL_NAME,
  USER_TASK_CREATE_TOOL_VERSION,
} from './execution-tool.constants';
import { ExecutionConfirmationService } from './execution-confirmation.service';
import { ExecutionService } from './execution.service';

const PLAN_TIMEOUT_MS = 30_000;
const CONFIRMATION_TIMEOUT_MS = 15 * 60_000;
const DELEGATION_TIMEOUT_MS = 10 * 60_000;

export interface PreparedToolPlan {
  invocation: ExecutionToolInvocationEntity;
  plan: ExecutionToolPlanEntity;
  duplicate: boolean;
}

@Injectable()
export class ExecutionToolPlanService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly contractValidator: ExecutionContractValidator,
    private readonly confirmations: ExecutionConfirmationService,
    private readonly executions: ExecutionService,
  ) {}

  async prepare(invocation: ToolInvocationContract): Promise<PreparedToolPlan> {
    this.contractValidator.assertToolInvocation(
      invocation as unknown as Record<string, unknown>,
    );
    this.assertUuid(invocation.toolCallId, 'toolCallId');
    this.assertUuid(invocation.executionContext.executionId, 'executionId');
    this.assertUuid(
      invocation.executionContext.causedByEventId,
      'causedByEventId',
    );
    if (invocation.requester.kind === 'model') {
      this.assertUuid(
        invocation.requester.operationId,
        'requester.operationId',
      );
      this.assertUuid(invocation.requester.attemptId, 'requester.attemptId');
    }

    const invocationHash = canonicalHash(invocation);
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`tool-call:${invocation.toolCallId}`],
      );
      const invocationRepo = manager.getRepository(
        ExecutionToolInvocationEntity,
      );
      const existing = await invocationRepo.findOne({
        where: { toolCallId: invocation.toolCallId },
        lock: { mode: 'pessimistic_write' },
      });
      if (existing) {
        if (existing.invocationHash !== invocationHash) {
          throw new ConflictException('idempotency_conflict');
        }
        const existingPlan = await manager
          .getRepository(ExecutionToolPlanEntity)
          .findOneBy({ toolCallId: invocation.toolCallId });
        if (!existingPlan) throw new ConflictException('incomplete_tool_plan');
        return { invocation: existing, plan: existingPlan, duplicate: true };
      }

      const execution = await this.lockActiveExecution(
        manager,
        invocation.executionContext.executionId,
      );
      await this.assertCause(manager, execution, invocation);
      await this.assertRequester(manager, execution, invocation);
      const planContract = this.preparePlan(invocation);
      this.contractValidator.assertToolPlan(
        planContract as unknown as Record<string, unknown>,
      );

      const storedInvocation = invocationRepo.create({
        toolCallId: invocation.toolCallId,
        executionId: execution.executionId,
        causedByEventId: invocation.executionContext.causedByEventId,
        schemaVersion: invocation.schemaVersion,
        name: invocation.name,
        invocation,
        invocationHash,
      });
      await invocationRepo.save(storedInvocation);
      const planRepo = manager.getRepository(ExecutionToolPlanEntity);
      const storedPlan = planRepo.create({
        operationId: planContract.operationId,
        executionId: execution.executionId,
        toolCallId: invocation.toolCallId,
        stepId: null,
        schemaVersion: planContract.schemaVersion,
        toolName: planContract.toolName,
        plan: planContract,
        planHash: canonicalHash(planContract),
        materializedAt: null,
      });
      await planRepo.save(storedPlan);
      await this.confirmations.createPending(manager, execution, storedPlan);
      if (execution.status !== ExecutionStatus.WAITING) {
        execution.phase = 'tool_planning';
      }
      await manager.getRepository(ExecutionEntity).save(execution);
      return {
        invocation: storedInvocation,
        plan: storedPlan,
        duplicate: false,
      };
    });
  }

  async materialize(
    toolCallId: string,
    budgetReservationId: string,
  ): Promise<ExecutionStepEntity | null> {
    this.assertUuid(toolCallId, 'toolCallId');
    this.assertUuid(budgetReservationId, 'budgetReservationId');
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`tool-call:${toolCallId}`],
      );
      const planRepo = manager.getRepository(ExecutionToolPlanEntity);
      const storedPlan = await planRepo.findOne({
        where: { toolCallId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!storedPlan) throw new NotFoundException('tool_plan_not_found');
      if (storedPlan.stepId) {
        const existingStep = await manager
          .getRepository(ExecutionStepEntity)
          .findOneBy({ stepId: storedPlan.stepId });
        if (!existingStep) throw new ConflictException('incomplete_tool_step');
        if (existingStep.budgetReservationId !== budgetReservationId) {
          throw new ConflictException('idempotency_conflict');
        }
        return existingStep;
      }

      const plan = storedPlan.plan;
      if (plan.policyDecision.decision === 'denied') {
        throw new ConflictException('tool_plan_not_allowed');
      }
      const confirmation = await this.confirmations.decisionForPlan(
        manager,
        storedPlan,
      );
      if (plan.policyDecision.decision === 'confirmation_required') {
        if (!confirmation) {
          throw new ConflictException('tool_confirmation_missing');
        }
        if (confirmation.status === 'pending') return null;
      } else if (plan.confirmationRequirement !== null || confirmation) {
        throw new ConflictException('tool_confirmation_mismatch');
      }
      const now = new Date();
      const deadline = new Date(plan.deadline);
      if (
        deadline <= now &&
        (!confirmation || confirmation.status === 'approved')
      ) {
        throw new ConflictException('tool_plan_expired');
      }
      const execution = await this.lockActiveExecution(
        manager,
        storedPlan.executionId,
      );
      const reservation =
        execution.progressLedger?.operationBudget?.reservations[
          storedPlan.operationId
        ];
      if (
        !reservation ||
        reservation.reservationId !== budgetReservationId ||
        reservation.status !== 'reserved' ||
        reservation.operationKind !== 'tool_call' ||
        reservation.toolCallId !== toolCallId
      ) {
        throw new ConflictException('tool_budget_not_reserved');
      }
      const invocation = await manager
        .getRepository(ExecutionToolInvocationEntity)
        .findOneBy({ toolCallId });
      if (!invocation) throw new ConflictException('incomplete_tool_plan');
      const dependsOnStepIds = await this.sourceDependencies(
        manager,
        invocation.invocation,
      );
      let delegationWork: Record<string, unknown> = {};
      if (plan.toolName === AGENT_DELEGATE_TOOL_NAME) {
        if (execution.parentExecutionId) {
          throw new ConflictException('delegation_depth_exceeded');
        }
        const goal = String(plan.normalizedArguments.goal ?? '');
        const child = await this.executions.createChildInference(
          manager,
          execution,
          {
            taskType: 'delegated-agent',
            payload: {
              goal,
              delegationOperationId: plan.operationId,
              joinPolicy: 'all',
              depth: 1,
            },
            work: {
              taskType: 'assistant-chat',
              agentName: 'subagent',
              payload: {
                conversation: [{ role: 'user', content: goal }],
                delegationMode: true,
              },
            },
            requiredCapability: 'assistant-chat',
            deadline,
            causedByEventId: invocation.causedByEventId,
          },
        );
        dependsOnStepIds.push(child.step.stepId);
        delegationWork = {
          childExecutionId: child.execution.executionId,
          childStepId: child.step.stepId,
          joinPolicy: 'all',
          delegationDepth: 1,
        };
      }
      const step = await createExecutionStep(manager, {
        executionId: execution.executionId,
        stepKind: ExecutionStepKind.TOOL,
        dependsOnStepIds,
        work: {
          taskType: plan.toolName,
          toolPlan: plan,
          ...delegationWork,
          ...(confirmation
            ? {
                confirmationDecision: {
                  confirmationId: confirmation.confirmationId,
                  planHash: confirmation.planHash,
                  status: confirmation.status,
                  decidedAt: confirmation.decidedAt?.toISOString() ?? null,
                },
              }
            : {}),
        },
        requiredCapabilities: plan.requiredCapabilities,
        resourceKeys: plan.resources.map((resource) => resource.resourceKey),
        budgetReservationId,
        deadline,
        operationId: plan.operationId,
        operationKind: ExecutionOperationKind.TOOL_CALL,
        recoveryClass: plan.recoveryClass as ExecutionOperationRecoveryClass,
        causedByEventId: invocation.causedByEventId,
      });
      storedPlan.stepId = step.stepId;
      storedPlan.materializedAt = now;
      await planRepo.save(storedPlan);
      execution.phase = null;
      await manager.getRepository(ExecutionEntity).save(execution);
      return step;
    });
  }

  activatePendingConfirmations(executionId: string): Promise<number> {
    return this.confirmations.activatePending(executionId);
  }

  private preparePlan(invocation: ToolInvocationContract): ToolPlanContract {
    if (invocation.name === DOCUMENT_SEARCH_TOOL_NAME) {
      return this.prepareDocumentsSearch(invocation);
    }
    if (invocation.name === USER_TASK_CREATE_TOOL_NAME) {
      return this.prepareUserTaskCreate(invocation);
    }
    if (invocation.name === AGENT_DELEGATE_TOOL_NAME) {
      return this.prepareAgentDelegation(invocation);
    }
    throw new BadRequestException('tool_not_available');
  }

  private prepareDocumentsSearch(
    invocation: ToolInvocationContract,
  ): ToolPlanContract {
    if (invocation.executionContext.dataClassification === 'secret') {
      throw new BadRequestException('data_policy_violation');
    }
    const keys = Object.keys(invocation.arguments);
    if (keys.some((key) => !['query', 'limit'].includes(key))) {
      throw new BadRequestException('invalid_arguments');
    }
    const query = String(invocation.arguments.query ?? '').trim();
    if (!query || query.length > 1_000) {
      throw new BadRequestException('invalid_arguments');
    }
    const requestedLimit = invocation.arguments.limit ?? 10;
    if (!Number.isInteger(requestedLimit)) {
      throw new BadRequestException('invalid_arguments');
    }
    const limit = Math.min(50, Math.max(1, Number(requestedLimit)));
    const preparedAt = new Date();
    return {
      schemaVersion: 'tool-plan/1',
      operationId: randomUUID(),
      toolCallId: invocation.toolCallId,
      toolName: DOCUMENT_SEARCH_TOOL_NAME,
      descriptorVersion: DOCUMENT_SEARCH_TOOL_VERSION,
      normalizedArguments: { query, limit },
      resources: [
        {
          resourceKey: 'documents:collection',
          mode: 'shared',
          kind: 'document_collection',
        },
      ],
      effects: [],
      policyDecision: { decision: 'allowed', rule: 'local_documents_read' },
      confirmationRequirement: null,
      recoveryClass: 'read_only_replayable',
      idempotencyKey: null,
      requiredCapabilities: [DOCUMENT_SEARCH_TOOL_CAPABILITY],
      deadline: new Date(preparedAt.getTime() + PLAN_TIMEOUT_MS).toISOString(),
      preparedAt: preparedAt.toISOString(),
    };
  }

  private prepareUserTaskCreate(
    invocation: ToolInvocationContract,
  ): ToolPlanContract {
    if (invocation.executionContext.dataClassification === 'secret') {
      throw new BadRequestException('data_policy_violation');
    }
    const keys = Object.keys(invocation.arguments);
    if (keys.some((key) => !['title', 'description'].includes(key))) {
      throw new BadRequestException('invalid_arguments');
    }
    const title = String(invocation.arguments.title ?? '').trim();
    if (!title || title.length > 200) {
      throw new BadRequestException('invalid_arguments');
    }
    const rawDescription = invocation.arguments.description;
    if (rawDescription !== undefined && typeof rawDescription !== 'string') {
      throw new BadRequestException('invalid_arguments');
    }
    const description =
      typeof rawDescription === 'string' ? rawDescription.trim() || null : null;
    if (description && description.length > 4_000) {
      throw new BadRequestException('invalid_arguments');
    }
    const preparedAt = new Date();
    const expiresAt = new Date(preparedAt.getTime() + CONFIRMATION_TIMEOUT_MS);
    return {
      schemaVersion: 'tool-plan/1',
      operationId: randomUUID(),
      toolCallId: invocation.toolCallId,
      toolName: USER_TASK_CREATE_TOOL_NAME,
      descriptorVersion: USER_TASK_CREATE_TOOL_VERSION,
      normalizedArguments: { title, description },
      resources: [
        {
          resourceKey: 'user-tasks:collection',
          mode: 'exclusive',
          kind: 'user_task_collection',
        },
      ],
      effects: [
        {
          effectClass: 'local_reversible',
          resourceKey: 'user-tasks:collection',
          description: `Create task: ${title}`,
          reversible: true,
          verificationRequired: true,
        },
      ],
      policyDecision: {
        decision: 'confirmation_required',
        rule: 'user_task_create_requires_confirmation',
        expiresAt: expiresAt.toISOString(),
      },
      confirmationRequirement: {
        confirmationId: randomUUID(),
        reason: 'Creating a task changes local workspace data.',
        prompt: `Create the task "${title}"?`,
        scope: 'once',
        expiresAt: expiresAt.toISOString(),
      },
      recoveryClass: 'effect_checked',
      idempotencyKey: `user-task:${invocation.toolCallId}`,
      requiredCapabilities: [USER_TASK_CREATE_TOOL_CAPABILITY],
      deadline: expiresAt.toISOString(),
      preparedAt: preparedAt.toISOString(),
    };
  }

  private prepareAgentDelegation(
    invocation: ToolInvocationContract,
  ): ToolPlanContract {
    if (invocation.executionContext.dataClassification === 'secret') {
      throw new BadRequestException('data_policy_violation');
    }
    if (Object.keys(invocation.arguments).some((key) => key !== 'goal')) {
      throw new BadRequestException('invalid_arguments');
    }
    const goal = String(invocation.arguments.goal ?? '').trim();
    if (!goal || goal.length > 4_000) {
      throw new BadRequestException('invalid_arguments');
    }
    const preparedAt = new Date();
    return {
      schemaVersion: 'tool-plan/1',
      operationId: randomUUID(),
      toolCallId: invocation.toolCallId,
      toolName: AGENT_DELEGATE_TOOL_NAME,
      descriptorVersion: AGENT_DELEGATE_TOOL_VERSION,
      normalizedArguments: { goal },
      resources: [
        {
          resourceKey: `execution-tree:${invocation.executionContext.executionId}`,
          mode: 'shared',
          kind: 'execution_tree',
        },
      ],
      effects: [],
      policyDecision: {
        decision: 'allowed',
        rule: 'bounded_internal_delegation',
        conditions: ['max_depth_1', 'single_inference', 'join_all'],
      },
      confirmationRequirement: null,
      recoveryClass: 'idempotent',
      idempotencyKey: `delegation:${invocation.toolCallId}`,
      requiredCapabilities: [AGENT_DELEGATE_TOOL_CAPABILITY],
      deadline: new Date(
        preparedAt.getTime() + DELEGATION_TIMEOUT_MS,
      ).toISOString(),
      preparedAt: preparedAt.toISOString(),
    };
  }

  private async lockActiveExecution(
    manager: EntityManager,
    executionId: string,
  ): Promise<ExecutionEntity> {
    const execution = await manager.getRepository(ExecutionEntity).findOne({
      where: { executionId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!execution) throw new NotFoundException('execution_not_found');
    if (
      ![ExecutionStatus.QUEUED, ExecutionStatus.RUNNING].includes(
        execution.status,
      )
    ) {
      throw new ConflictException('execution_not_active');
    }
    if (execution.cancellationRequestedAt) {
      throw new ConflictException('execution_cancellation_requested');
    }
    return execution;
  }

  private async assertCause(
    manager: EntityManager,
    execution: ExecutionEntity,
    invocation: ToolInvocationContract,
  ): Promise<void> {
    const event = await manager.getRepository(ExecutionEventEntity).findOneBy({
      eventId: invocation.executionContext.causedByEventId,
      rootExecutionId: execution.rootExecutionId,
    });
    if (!event) throw new BadRequestException('invalid_tool_cause');
  }

  private async assertRequester(
    manager: EntityManager,
    execution: ExecutionEntity,
    invocation: ToolInvocationContract,
  ): Promise<void> {
    if (invocation.requester.kind === 'deterministic') {
      if (invocation.requester.component !== 'documents-backend') {
        throw new BadRequestException('invalid_tool_requester');
      }
      return;
    }
    const attempt = await manager
      .getRepository(ExecutionStepAttemptEntity)
      .findOneBy({
        attemptId: invocation.requester.attemptId,
        executionId: execution.executionId,
      });
    if (
      !attempt ||
      attempt.operationId !== invocation.requester.operationId ||
      attempt.status !== ExecutionStepAttemptStatus.CLOSED
    ) {
      throw new BadRequestException('invalid_tool_requester');
    }
  }

  private async sourceDependencies(
    manager: EntityManager,
    invocation: ToolInvocationContract,
  ): Promise<string[]> {
    if (invocation.requester.kind === 'deterministic') return [];
    const source = await manager.getRepository(ExecutionStepEntity).findOneBy({
      executionId: invocation.executionContext.executionId,
      operationId: invocation.requester.operationId,
    });
    if (!source || source.status !== ExecutionStepStatus.COMPLETED) {
      throw new ConflictException('tool_request_source_not_accepted');
    }
    return [source.stepId];
  }

  private assertUuid(value: string, field: string): void {
    if (!EXECUTION_UUID_PATTERN.test(value)) {
      throw new BadRequestException(`${field} must be a UUID`);
    }
  }
}

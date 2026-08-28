import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ExecutionContractValidator } from './execution-contract-validator';
import { EXECUTION_UUID_PATTERN } from './execution.constants';
import { ExecutionEntity } from './execution.entity';
import { ExecutionEventEntity } from './execution-event.entity';
import { ExecutionOperationKind } from './execution-operation-kind.enum';
import { ExecutionOperationEntity } from './execution-operation.entity';
import { ExecutionOperationStatus } from './execution-operation-status.enum';
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
  ToolResultContract,
} from './execution-tool.types';
import { canonicalHash } from './execution-canonical';
import { AGENT_DELEGATE_TOOL_NAME } from './execution-tool.constants';
import { ExecutionConfirmationService } from './execution-confirmation.service';
import { ExecutionConfirmationStatus } from './execution-confirmation.types';
import { ExecutionService } from './execution.service';
import type { ChatExecutionPayload } from './execution-task-payload.types';
import { getToolPlanPreparer } from './tool-planners';

export interface PreparedToolPlan {
  invocation: ExecutionToolInvocationEntity;
  plan: ExecutionToolPlanEntity;
  duplicate: boolean;
}

export type ToolPlanMaterializationDisposition =
  | { kind: 'ready' }
  | { kind: 'waiting_confirmation' }
  | {
      kind: 'not_executed';
      error: { code: string; message: string };
    };

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
      const planContract = this.preparePlan(invocation, execution);
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
      const confirmation = await this.confirmations.decisionForPlan(
        manager,
        storedPlan,
      );
      const now = new Date();
      const disposition = this.materializationDisposition(
        storedPlan,
        confirmation?.status ?? null,
        now,
      );
      if (disposition.kind === 'waiting_confirmation') return null;
      if (disposition.kind === 'not_executed') {
        return this.materializeNotExecutedWithManager(
          manager,
          storedPlan,
          disposition.error,
        );
      }
      const deadline = new Date(plan.deadline);
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
        const parentPayload = this.chatPayload(execution);
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
              agentLoop: {
                schemaVersion: 'agent-inference/1',
                purpose: 'normal',
                phase: 'agent_loop',
                sourceStepId: null,
                evidenceStepIds: [],
              },
              payload: {
                conversation: [{ role: 'user', content: goal }],
                delegationMode: true,
                activeMemory: null,
                activeCapabilities: null,
                ...(parentPayload.conversationContext
                  ? {
                      conversationContext: parentPayload.conversationContext,
                    }
                  : {}),
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

  async materializeNotExecuted(
    toolCallId: string,
    error: { code: string; message: string },
  ): Promise<ExecutionStepEntity> {
    this.assertUuid(toolCallId, 'toolCallId');
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
      return this.materializeNotExecutedWithManager(manager, storedPlan, error);
    });
  }

  async getMaterializationDisposition(
    toolCallId: string,
  ): Promise<ToolPlanMaterializationDisposition> {
    this.assertUuid(toolCallId, 'toolCallId');
    return this.dataSource.transaction(async (manager) => {
      const storedPlan = await manager
        .getRepository(ExecutionToolPlanEntity)
        .findOneBy({ toolCallId });
      if (!storedPlan) throw new NotFoundException('tool_plan_not_found');
      const confirmation = await this.confirmations.decisionForPlan(
        manager,
        storedPlan,
      );
      return this.materializationDisposition(
        storedPlan,
        confirmation?.status ?? null,
        new Date(),
      );
    });
  }

  activatePendingConfirmations(executionId: string): Promise<number> {
    return this.confirmations.activatePending(executionId);
  }

  private materializationDisposition(
    storedPlan: ExecutionToolPlanEntity,
    confirmationStatus: ExecutionConfirmationStatus | null,
    now: Date,
  ): ToolPlanMaterializationDisposition {
    const plan = storedPlan.plan;
    if (plan.policyDecision.decision === 'denied') {
      return {
        kind: 'not_executed',
        error: {
          code: 'tool_policy_denied',
          message: 'The tool operation was denied by policy',
        },
      };
    }
    if (plan.policyDecision.decision === 'confirmation_required') {
      if (!confirmationStatus) {
        throw new ConflictException('tool_confirmation_missing');
      }
      if (confirmationStatus === 'pending') {
        return { kind: 'waiting_confirmation' };
      }
      if (confirmationStatus !== 'approved') {
        return {
          kind: 'not_executed',
          error: {
            code:
              confirmationStatus === 'expired'
                ? 'tool_confirmation_expired'
                : 'tool_confirmation_denied',
            message:
              confirmationStatus === 'expired'
                ? 'The tool operation was not executed because confirmation expired'
                : 'The tool operation was not executed because confirmation was denied',
          },
        };
      }
    } else if (plan.confirmationRequirement !== null || confirmationStatus) {
      throw new ConflictException('tool_confirmation_mismatch');
    }
    if (new Date(plan.deadline) <= now) {
      return {
        kind: 'not_executed',
        error: {
          code: 'tool_plan_expired',
          message:
            'The tool operation was not executed because its plan expired',
        },
      };
    }
    return { kind: 'ready' };
  }

  private async materializeNotExecutedWithManager(
    manager: EntityManager,
    storedPlan: ExecutionToolPlanEntity,
    error: { code: string; message: string },
  ): Promise<ExecutionStepEntity> {
    const planRepo = manager.getRepository(ExecutionToolPlanEntity);
    if (storedPlan.stepId) {
      const existing = await manager
        .getRepository(ExecutionStepEntity)
        .findOneBy({ stepId: storedPlan.stepId });
      const toolResult = (existing?.result as Record<string, unknown> | null)
        ?.toolResult as ToolResultContract | undefined;
      if (
        !existing ||
        existing.status !== ExecutionStepStatus.COMPLETED ||
        toolResult?.status !== 'not_executed' ||
        toolResult.error?.code !== error.code
      ) {
        throw new ConflictException('tool_result_already_materialized');
      }
      return existing;
    }

    const execution = await this.lockActiveExecution(
      manager,
      storedPlan.executionId,
    );
    const invocation = await manager
      .getRepository(ExecutionToolInvocationEntity)
      .findOneBy({ toolCallId: storedPlan.toolCallId });
    if (!invocation) throw new ConflictException('incomplete_tool_plan');
    const toolResult: ToolResultContract = {
      schemaVersion: 'tool-result/1',
      operationId: storedPlan.operationId,
      toolCallId: storedPlan.toolCallId,
      status: 'not_executed',
      content: '',
      structuredContent: null,
      artifactRefs: [],
      sourceRefs: [],
      effects: [],
      error: { ...error, retryable: false },
    };
    this.contractValidator.assertToolResult(
      toolResult as unknown as Record<string, unknown>,
    );
    const step = await createExecutionStep(manager, {
      executionId: execution.executionId,
      stepKind: ExecutionStepKind.TOOL,
      dependsOnStepIds: await this.sourceDependencies(
        manager,
        invocation.invocation,
      ),
      work: {
        taskType: storedPlan.toolName,
        toolPlan: storedPlan.plan,
        coordinationDecision: {
          kind: 'not_executed',
          reason: error.code,
        },
      },
      requiredCapabilities: [],
      resourceKeys: [],
      operationId: storedPlan.operationId,
      operationKind: ExecutionOperationKind.TOOL_CALL,
      recoveryClass: storedPlan.plan
        .recoveryClass as ExecutionOperationRecoveryClass,
      causedByEventId: invocation.causedByEventId,
    });
    step.status = ExecutionStepStatus.COMPLETED;
    step.result = { kind: ExecutionStepKind.TOOL, toolResult };
    step.version += 1;
    await manager.getRepository(ExecutionStepEntity).save(step);
    const operation = await manager
      .getRepository(ExecutionOperationEntity)
      .findOneByOrFail({ operationId: storedPlan.operationId });
    operation.status = ExecutionOperationStatus.NOT_EXECUTED;
    operation.result = toolResult;
    operation.error = error;
    operation.finishedAt = new Date();
    await manager.getRepository(ExecutionOperationEntity).save(operation);
    storedPlan.stepId = step.stepId;
    storedPlan.materializedAt = new Date();
    await planRepo.save(storedPlan);
    return step;
  }

  private preparePlan(
    invocation: ToolInvocationContract,
    execution: ExecutionEntity,
  ): ToolPlanContract {
    const payload = this.chatPayload(execution);
    const selectedTools = Array.isArray(payload.activeCapabilities?.tools)
      ? payload.activeCapabilities.tools
      : [];
    if (!selectedTools.some((tool) => tool.name === invocation.name)) {
      throw new BadRequestException('tool_not_available_for_turn');
    }
    const preparer = getToolPlanPreparer(invocation.name);
    if (!preparer) {
      throw new BadRequestException('tool_not_available');
    }
    return preparer(invocation, execution);
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

  private chatPayload(execution: ExecutionEntity): ChatExecutionPayload {
    if (
      execution.taskType !== 'assistant-chat' &&
      execution.taskType !== 'agent-chat'
    ) {
      throw new BadRequestException('invalid_chat_execution_type');
    }
    return execution.payload as ChatExecutionPayload;
  }

  private assertUuid(value: string, field: string): void {
    if (!EXECUTION_UUID_PATTERN.test(value)) {
      throw new BadRequestException(`${field} must be a UUID`);
    }
  }
}

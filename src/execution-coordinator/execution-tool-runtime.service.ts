import { Inject, Injectable, Logger } from '@nestjs/common';
import { ExecutionAttemptService } from '../execution/execution-attempt.service';
import { ExecutionContractValidator } from '../execution/execution-contract-validator';
import { StepAssignment } from '../execution/execution-control-plane.types';
import { ExecutionStepKind } from '../execution/execution-step-kind.enum';
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
} from '../execution/execution-tool.constants';
import {
  ToolPlanContract,
  ToolResultContract,
} from '../execution/execution-tool.types';
import { SearchResultDto } from '../search/dto/search-result.dto';
import { BACKEND_RUNTIME_FINGERPRINT } from '../execution/execution-runtime';
import { canonicalHash } from '../execution/execution-canonical';
import { UserTaskEntity } from '../user-task/user-task.entity';
import { ExecutionService } from '../execution/execution.service';
import { ExecutionStatus } from '../execution/execution-status.enum';

const TOOL_RUNTIME_WORKER_ID = '00000000-0000-4000-8000-000000000001';
const TOOL_LEASE_MS = 30_000;
export const DOCUMENT_SEARCH_PROVIDER = Symbol('DOCUMENT_SEARCH_PROVIDER');
export const USER_TASK_CREATE_PROVIDER = Symbol('USER_TASK_CREATE_PROVIDER');

export interface DocumentSearchProvider {
  globalSearch(query: string): Promise<SearchResultDto[]>;
}

export interface UserTaskCreateProvider {
  createFromExecution(
    operationId: string,
    title: string,
    description: string | null,
  ): Promise<UserTaskEntity>;
  findByExecutionOperation(operationId: string): Promise<UserTaskEntity | null>;
}

@Injectable()
export class ExecutionToolRuntimeService {
  private readonly logger = new Logger(ExecutionToolRuntimeService.name);

  constructor(
    private readonly attempts: ExecutionAttemptService,
    private readonly contracts: ExecutionContractValidator,
    @Inject(DOCUMENT_SEARCH_PROVIDER)
    private readonly search: DocumentSearchProvider,
    @Inject(USER_TASK_CREATE_PROVIDER)
    private readonly userTasks: UserTaskCreateProvider,
    private readonly executions: ExecutionService,
  ) {}

  async executeReady(limit = 20): Promise<number> {
    let executed = 0;
    while (executed < limit) {
      const assignment = await this.attempts.claimReadyStep({
        workerId: TOOL_RUNTIME_WORKER_ID,
        stepKinds: [ExecutionStepKind.TOOL],
        capabilities: [
          DOCUMENT_SEARCH_TOOL_CAPABILITY,
          USER_TASK_CREATE_TOOL_CAPABILITY,
          AGENT_DELEGATE_TOOL_CAPABILITY,
        ],
        leaseDurationMs: TOOL_LEASE_MS,
      });
      if (!assignment) break;
      await this.executeAssignment(assignment);
      executed += 1;
    }
    return executed;
  }

  private async executeAssignment(assignment: StepAssignment): Promise<void> {
    const { plan, confirmationStatus } = this.readPlan(assignment);
    await this.attempts.startAttempt(
      assignment.attemptId,
      TOOL_RUNTIME_WORKER_ID,
    );

    let result: ToolResultContract;
    try {
      if (confirmationStatus && confirmationStatus !== 'approved') {
        result = this.notExecutedResult(plan, confirmationStatus);
      } else if (plan.toolName === DOCUMENT_SEARCH_TOOL_NAME) {
        result = await this.executeDocumentsSearch(plan);
      } else if (plan.toolName === AGENT_DELEGATE_TOOL_NAME) {
        result = await this.executeAgentDelegation(assignment, plan);
      } else {
        result = await this.executeUserTaskCreate(plan);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Tool ${plan.toolCallId} failed during execution: ${message}`,
      );
      result = {
        schemaVersion: 'tool-result/1',
        operationId: plan.operationId,
        toolCallId: plan.toolCallId,
        status: 'failed',
        content: '',
        structuredContent: null,
        artifactRefs: [],
        sourceRefs: [],
        effects: [],
        error: {
          code: 'tool_execution_failed',
          message: 'The tool operation could not be completed',
          retryable: true,
        },
      };
    }
    this.contracts.assertToolResult(
      result as unknown as Record<string, unknown>,
    );
    const status = ['succeeded', 'not_executed'].includes(result.status)
      ? 'succeeded'
      : result.status === 'cancelled'
        ? 'cancelled'
        : 'failed';
    const ack = await this.attempts.receiveResult({
      executionId: assignment.executionId,
      stepId: assignment.stepId,
      operationId: assignment.operationId,
      attemptId: assignment.attemptId,
      workerId: TOOL_RUNTIME_WORKER_ID,
      result: {
        schemaVersion: 'step-result/1',
        executionId: assignment.executionId,
        stepId: assignment.stepId,
        operationId: assignment.operationId,
        attemptId: assignment.attemptId,
        stepKind: ExecutionStepKind.TOOL,
        status,
        runtimeFingerprint: BACKEND_RUNTIME_FINGERPRINT,
        output: { kind: ExecutionStepKind.TOOL, toolResult: result },
        artifactRefs: result.artifactRefs,
        error: result.error,
      },
    });
    if (!['received', 'duplicate'].includes(ack.code)) {
      this.logger.warn(
        `Tool result ${plan.toolCallId} was not accepted: ${ack.code}`,
      );
    }
  }

  private readPlan(assignment: StepAssignment): {
    plan: ToolPlanContract;
    confirmationStatus: 'approved' | 'denied' | 'expired' | null;
  } {
    const plan = assignment.work.toolPlan as ToolPlanContract | undefined;
    if (!plan) throw new Error('tool_plan_missing');
    this.contracts.assertToolPlan(plan as unknown as Record<string, unknown>);
    if (plan.operationId !== assignment.operationId) {
      throw new Error('tool_plan_not_executable');
    }
    if (plan.toolName === DOCUMENT_SEARCH_TOOL_NAME) {
      if (
        plan.descriptorVersion !== DOCUMENT_SEARCH_TOOL_VERSION ||
        plan.policyDecision.decision !== 'allowed' ||
        plan.confirmationRequirement !== null ||
        plan.effects.length !== 0
      ) {
        throw new Error('tool_plan_not_executable');
      }
      return { plan, confirmationStatus: null };
    }
    if (plan.toolName === AGENT_DELEGATE_TOOL_NAME) {
      if (
        plan.descriptorVersion !== AGENT_DELEGATE_TOOL_VERSION ||
        plan.policyDecision.decision !== 'allowed' ||
        plan.confirmationRequirement !== null ||
        plan.effects.length !== 0 ||
        assignment.work.joinPolicy !== 'all' ||
        assignment.work.delegationDepth !== 1
      ) {
        throw new Error('tool_plan_not_executable');
      }
      return { plan, confirmationStatus: null };
    }
    if (
      plan.toolName !== USER_TASK_CREATE_TOOL_NAME ||
      plan.descriptorVersion !== USER_TASK_CREATE_TOOL_VERSION ||
      plan.policyDecision.decision !== 'confirmation_required' ||
      !plan.confirmationRequirement ||
      plan.effects.length !== 1
    ) {
      throw new Error('tool_plan_not_executable');
    }
    const decision = assignment.work.confirmationDecision as
      Record<string, unknown> | undefined;
    if (
      !decision ||
      decision.confirmationId !== plan.confirmationRequirement.confirmationId ||
      decision.planHash !== canonicalHash(plan) ||
      typeof decision.decidedAt !== 'string' ||
      !['approved', 'denied', 'expired'].includes(String(decision.status))
    ) {
      throw new Error('tool_confirmation_not_authorized');
    }
    return {
      plan,
      confirmationStatus: decision.status as 'approved' | 'denied' | 'expired',
    };
  }

  private async executeUserTaskCreate(
    plan: ToolPlanContract,
  ): Promise<ToolResultContract> {
    const title = String(plan.normalizedArguments.title ?? '');
    const description = plan.normalizedArguments.description;
    const task = await this.userTasks.createFromExecution(
      plan.operationId,
      title,
      typeof description === 'string' ? description : null,
    );
    const verified = await this.userTasks.findByExecutionOperation(
      plan.operationId,
    );
    if (!verified || verified.id !== task.id || verified.title !== title) {
      throw new Error('user_task_effect_not_verified');
    }
    return {
      schemaVersion: 'tool-result/1',
      operationId: plan.operationId,
      toolCallId: plan.toolCallId,
      status: 'succeeded',
      content: `Created task: ${task.title}`,
      structuredContent: {
        id: task.id,
        title: task.title,
        status: task.status,
      },
      artifactRefs: [],
      sourceRefs: [],
      effects: [
        {
          effectClass: 'local_reversible',
          resourceKey: 'user-tasks:collection',
          status: 'applied',
        },
      ],
      error: null,
    };
  }

  private async executeAgentDelegation(
    assignment: StepAssignment,
    plan: ToolPlanContract,
  ): Promise<ToolResultContract> {
    const childExecutionId = String(assignment.work.childExecutionId ?? '');
    const child = await this.executions.findOne(childExecutionId);
    if (
      !child ||
      child.parentExecutionId !== assignment.executionId ||
      child.payload?.delegationOperationId !== plan.operationId
    ) {
      throw new Error('delegated_execution_not_found');
    }
    if (
      ![
        ExecutionStatus.COMPLETED,
        ExecutionStatus.FAILED,
        ExecutionStatus.CANCELLED,
      ].includes(child.status)
    ) {
      throw new Error('delegated_execution_not_terminal');
    }
    const childResult = child.result as Record<string, unknown> | string | null;
    const content =
      typeof childResult === 'string'
        ? childResult
        : typeof childResult?.reply === 'string'
          ? childResult.reply
          : '';
    const status =
      child.status === ExecutionStatus.COMPLETED
        ? 'succeeded'
        : child.status === ExecutionStatus.CANCELLED
          ? 'cancelled'
          : 'failed';
    return {
      schemaVersion: 'tool-result/1',
      operationId: plan.operationId,
      toolCallId: plan.toolCallId,
      status,
      content,
      structuredContent: {
        childExecutionId,
        childStatus: child.status,
        joinPolicy: 'all',
      },
      artifactRefs: [],
      sourceRefs: [],
      effects: [],
      error:
        status === 'failed'
          ? {
              code: 'delegated_execution_failed',
              message: 'The delegated execution failed',
              retryable: false,
            }
          : null,
    };
  }

  private notExecutedResult(
    plan: ToolPlanContract,
    status: 'denied' | 'expired',
  ): ToolResultContract {
    return {
      schemaVersion: 'tool-result/1',
      operationId: plan.operationId,
      toolCallId: plan.toolCallId,
      status: 'not_executed',
      content:
        status === 'denied'
          ? 'The user denied this action.'
          : 'The confirmation expired before execution.',
      structuredContent: { confirmationStatus: status },
      artifactRefs: [],
      sourceRefs: [],
      effects: plan.effects.map((effect) => ({
        effectClass: effect.effectClass,
        resourceKey: effect.resourceKey,
        status: 'not_applied' as const,
      })),
      error: null,
    };
  }

  private async executeDocumentsSearch(
    plan: ToolPlanContract,
  ): Promise<ToolResultContract> {
    const query = String(plan.normalizedArguments.query ?? '');
    const limit = Number(plan.normalizedArguments.limit);
    const results = (await this.search.globalSearch(query)).slice(0, limit);
    const structuredResults = results.map((result) => ({
      id: result.id,
      name: result.name,
      collection: result.collection,
      scoreMillionths: Number.isFinite(result.score)
        ? Math.round(result.score * 1_000_000)
        : 0,
      ...(result.highlightedName
        ? { highlightedName: result.highlightedName }
        : {}),
      ...(result.highlightedTitle
        ? { highlightedTitle: result.highlightedTitle }
        : {}),
      ...(result.highlightedContent
        ? { highlightedContent: result.highlightedContent }
        : {}),
    }));
    return {
      schemaVersion: 'tool-result/1',
      operationId: plan.operationId,
      toolCallId: plan.toolCallId,
      status: 'succeeded',
      content: this.resultContent(results),
      structuredContent: {
        query,
        count: structuredResults.length,
        results: structuredResults,
      },
      artifactRefs: [],
      sourceRefs: [],
      effects: [],
      error: null,
    };
  }

  private resultContent(results: SearchResultDto[]): string {
    if (!results.length) return 'No matching documents were found.';
    return results
      .map((result) => `${result.collection}:${result.id} ${result.name}`)
      .join('\n')
      .slice(0, 8_000);
  }
}

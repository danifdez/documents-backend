import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
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
  SKILL_RESOURCE_LOAD_TOOL_CAPABILITY,
  SKILL_RESOURCE_LOAD_TOOL_NAME,
  SKILL_RESOURCE_LOAD_TOOL_VERSION,
  USER_TASK_CREATE_TOOL_CAPABILITY,
  USER_TASK_CREATE_TOOL_NAME,
  USER_TASK_CREATE_TOOL_VERSION,
  WORKSPACE_FILE_READ_TOOL_CAPABILITY,
  WORKSPACE_FILE_READ_TOOL_NAME,
  WORKSPACE_FILE_READ_TOOL_VERSION,
  WORKSPACE_FILE_LIST_TOOL_CAPABILITY,
  WORKSPACE_FILE_LIST_TOOL_NAME,
  WORKSPACE_FILE_LIST_TOOL_VERSION,
  WORKSPACE_FILE_SEARCH_TOOL_CAPABILITY,
  WORKSPACE_FILE_SEARCH_TOOL_NAME,
  WORKSPACE_FILE_SEARCH_TOOL_VERSION,
  WORKSPACE_FILE_WRITE_TOOL_CAPABILITY,
  WORKSPACE_FILE_WRITE_TOOL_NAME,
  WORKSPACE_FILE_WRITE_TOOL_VERSION,
  WORKSPACE_FILE_DELETE_TOOL_CAPABILITY,
  WORKSPACE_FILE_DELETE_TOOL_NAME,
  WORKSPACE_FILE_DELETE_TOOL_VERSION,
  LOCAL_TOOL_RUNTIME_WORKER_ID,
} from '../execution/execution-tool.constants';
import { resolveProductSkillResource } from '../conversation/product-skill-registry';
import {
  ToolPlanContract,
  ToolResultContract,
} from '../execution/execution-tool.types';
import { SearchResultDto } from '../search/dto/search-result.dto';
import { BACKEND_RUNTIME_FINGERPRINT } from '../execution/execution-runtime';
import { canonicalHash, contentHash } from '../execution/execution-canonical';
import { UserTaskEntity } from '../user-task/user-task.entity';
import { ExecutionService } from '../execution/execution.service';
import { ExecutionStatus } from '../execution/execution-status.enum';
import type { DelegatedAgentExecutionPayload } from '../execution/execution-task-payload.types';
import {
  IndexedFileService,
  OwnerRef,
} from '../indexed-file/indexed-file.service';
import {
  DurableExternalEffectState,
  ExecutionEffectJournalService,
  VerifiedExecutionEffectInput,
} from '../execution/execution-effect-journal.service';

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

interface WorkspaceFileSnapshot extends Record<string, unknown> {
  schemaVersion: 'workspace-file-snapshot/1';
  filename: string;
  exists: boolean | null;
  indexedFileId: number | null;
  contentHash: string | null;
  size: number | null;
}

interface WorkspaceFileEffectObservation extends Record<string, unknown> {
  schemaVersion: 'workspace-file-effect-observation/1';
  operation: 'write' | 'delete';
  effectStatus: 'applied' | 'not_applied' | 'inconclusive';
  reason: string;
  file: WorkspaceFileSnapshot;
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
    private readonly indexedFiles: IndexedFileService,
    private readonly executions: ExecutionService,
    private readonly effectJournal: ExecutionEffectJournalService,
  ) {}

  async executeReady(limit = 20): Promise<number> {
    let executed = 0;
    while (executed < limit) {
      const assignment = await this.attempts.claimReadyStep({
        workerId: LOCAL_TOOL_RUNTIME_WORKER_ID,
        stepKinds: [ExecutionStepKind.TOOL],
        capabilities: [
          DOCUMENT_SEARCH_TOOL_CAPABILITY,
          SKILL_RESOURCE_LOAD_TOOL_CAPABILITY,
          USER_TASK_CREATE_TOOL_CAPABILITY,
          AGENT_DELEGATE_TOOL_CAPABILITY,
          WORKSPACE_FILE_READ_TOOL_CAPABILITY,
          WORKSPACE_FILE_LIST_TOOL_CAPABILITY,
          WORKSPACE_FILE_SEARCH_TOOL_CAPABILITY,
          WORKSPACE_FILE_WRITE_TOOL_CAPABILITY,
          WORKSPACE_FILE_DELETE_TOOL_CAPABILITY,
        ],
        leaseDurationMs: TOOL_LEASE_MS,
      });
      if (!assignment) break;
      await this.executeAssignment(assignment);
      executed += 1;
    }
    return executed;
  }

  async recoverStaleEffects(limit = 20): Promise<number> {
    const candidates = await this.attempts.findRecoverableLocalEffects(limit);
    let recovered = 0;
    for (const candidate of candidates) {
      try {
        const { plan } = this.readPlan(candidate.assignment);
        const observation = await this.runWorkspaceFileEffect(
          candidate.assignment,
          plan,
          true,
        );
        if (
          observation.effectStatus === 'not_applied' &&
          !candidate.cancellationRequested &&
          [
            'workspace_baseline_unchanged',
            'workspace_effect_not_prepared',
            'lease_expired_before_effect',
          ].includes(observation.reason)
        ) {
          if (
            await this.attempts.requeueVerifiedNotAppliedEffect(
              candidate.assignment.attemptId,
            )
          ) {
            recovered += 1;
          }
          continue;
        }
        if (
          observation.effectStatus === 'not_applied' &&
          candidate.cancellationRequested
        ) {
          const operation =
            plan.toolName === WORKSPACE_FILE_WRITE_TOOL_NAME
              ? 'write'
              : 'delete';
          await this.effectJournal.recordExternalObservation(
            this.workspaceEffectInput(
              candidate.assignment,
              plan,
              operation,
              this.workspaceWriteBody(plan),
            ),
            observation,
            'verified',
          );
        }
        const result = await this.workspaceObservationResult(
          candidate.assignment,
          plan,
          observation,
          candidate.cancellationRequested,
        );
        const ack = await this.submitResult(candidate.assignment, result, true);
        if (['received', 'duplicate'].includes(ack)) recovered += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Workspace effect recovery ${candidate.assignment.operationId} failed: ${message}`,
        );
      }
    }
    return recovered;
  }

  private async executeAssignment(assignment: StepAssignment): Promise<void> {
    const { plan, confirmationStatus } = this.readPlan(assignment);
    await this.attempts.startAttempt(
      assignment.attemptId,
      LOCAL_TOOL_RUNTIME_WORKER_ID,
    );

    let result: ToolResultContract;
    try {
      if (confirmationStatus && confirmationStatus !== 'approved') {
        result = this.notExecutedResult(plan, confirmationStatus);
      } else if (plan.toolName === DOCUMENT_SEARCH_TOOL_NAME) {
        result = await this.executeDocumentsSearch(plan);
      } else if (plan.toolName === AGENT_DELEGATE_TOOL_NAME) {
        result = await this.executeAgentDelegation(assignment, plan);
      } else if (plan.toolName === SKILL_RESOURCE_LOAD_TOOL_NAME) {
        result = this.executeSkillResourceLoad(plan);
      } else if (plan.toolName === WORKSPACE_FILE_READ_TOOL_NAME) {
        result = await this.executeWorkspaceFileRead(plan);
      } else if (plan.toolName === WORKSPACE_FILE_LIST_TOOL_NAME) {
        result = await this.executeWorkspaceFileList(plan);
      } else if (plan.toolName === WORKSPACE_FILE_SEARCH_TOOL_NAME) {
        result = await this.executeWorkspaceFileSearch(plan);
      } else if (plan.toolName === WORKSPACE_FILE_WRITE_TOOL_NAME) {
        result = await this.executeWorkspaceFileWrite(assignment, plan);
      } else if (plan.toolName === WORKSPACE_FILE_DELETE_TOOL_NAME) {
        result = await this.executeWorkspaceFileDelete(assignment, plan);
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
    await this.submitResult(assignment, result, false);
  }

  private async submitResult(
    assignment: StepAssignment,
    result: ToolResultContract,
    recovered: boolean,
  ): Promise<string> {
    this.contracts.assertToolResult(
      result as unknown as Record<string, unknown>,
    );
    const status = ['succeeded', 'not_executed'].includes(result.status)
      ? 'succeeded'
      : result.status === 'cancelled'
        ? 'cancelled'
        : 'failed';
    const receive = recovered
      ? this.attempts.receiveRecoveredEffectResult.bind(this.attempts)
      : this.attempts.receiveResult.bind(this.attempts);
    const ack = await receive({
      executionId: assignment.executionId,
      stepId: assignment.stepId,
      operationId: assignment.operationId,
      attemptId: assignment.attemptId,
      workerId: LOCAL_TOOL_RUNTIME_WORKER_ID,
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
        `Tool result ${result.toolCallId} was not accepted: ${ack.code}`,
      );
    }
    return ack.code;
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
    if (plan.toolName === SKILL_RESOURCE_LOAD_TOOL_NAME) {
      if (
        plan.descriptorVersion !== SKILL_RESOURCE_LOAD_TOOL_VERSION ||
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
    if (plan.toolName === WORKSPACE_FILE_READ_TOOL_NAME) {
      if (
        plan.descriptorVersion !== WORKSPACE_FILE_READ_TOOL_VERSION ||
        plan.policyDecision.decision !== 'allowed' ||
        plan.confirmationRequirement !== null ||
        plan.effects.length !== 0
      ) {
        throw new Error('tool_plan_not_executable');
      }
      return { plan, confirmationStatus: null };
    }
    if (plan.toolName === WORKSPACE_FILE_LIST_TOOL_NAME) {
      if (
        plan.descriptorVersion !== WORKSPACE_FILE_LIST_TOOL_VERSION ||
        plan.policyDecision.decision !== 'allowed' ||
        plan.confirmationRequirement !== null ||
        plan.effects.length !== 0
      ) {
        throw new Error('tool_plan_not_executable');
      }
      return { plan, confirmationStatus: null };
    }
    if (plan.toolName === WORKSPACE_FILE_SEARCH_TOOL_NAME) {
      if (
        plan.descriptorVersion !== WORKSPACE_FILE_SEARCH_TOOL_VERSION ||
        plan.policyDecision.decision !== 'allowed' ||
        plan.confirmationRequirement !== null ||
        plan.effects.length !== 0
      ) {
        throw new Error('tool_plan_not_executable');
      }
      return { plan, confirmationStatus: null };
    }
    if (plan.toolName === WORKSPACE_FILE_WRITE_TOOL_NAME) {
      if (
        plan.descriptorVersion !== WORKSPACE_FILE_WRITE_TOOL_VERSION ||
        plan.policyDecision.decision !== 'confirmation_required' ||
        !plan.confirmationRequirement ||
        plan.effects.length !== 1
      ) {
        throw new Error('tool_plan_not_executable');
      }
      return {
        plan,
        confirmationStatus: this.readConfirmationDecision(assignment, plan),
      };
    }
    if (plan.toolName === WORKSPACE_FILE_DELETE_TOOL_NAME) {
      if (
        plan.descriptorVersion !== WORKSPACE_FILE_DELETE_TOOL_VERSION ||
        plan.policyDecision.decision !== 'confirmation_required' ||
        !plan.confirmationRequirement ||
        plan.effects.length !== 1
      ) {
        throw new Error('tool_plan_not_executable');
      }
      return {
        plan,
        confirmationStatus: this.readConfirmationDecision(assignment, plan),
      };
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
    return {
      plan,
      confirmationStatus: this.readConfirmationDecision(assignment, plan),
    };
  }

  private readConfirmationDecision(
    assignment: StepAssignment,
    plan: ToolPlanContract,
  ): 'approved' | 'denied' | 'expired' {
    const requirement = plan.confirmationRequirement;
    if (!requirement) throw new Error('tool_confirmation_not_authorized');
    const decision = assignment.work.confirmationDecision as
      Record<string, unknown> | undefined;
    if (
      !decision ||
      decision.confirmationId !== requirement.confirmationId ||
      decision.planHash !== canonicalHash(plan) ||
      typeof decision.decidedAt !== 'string' ||
      !['approved', 'denied', 'expired'].includes(String(decision.status))
    ) {
      throw new Error('tool_confirmation_not_authorized');
    }
    return decision.status as 'approved' | 'denied' | 'expired';
  }

  private async executeWorkspaceFileRead(
    plan: ToolPlanContract,
  ): Promise<ToolResultContract> {
    const owner = await this.workspaceOwner(plan);
    const filename = String(plan.normalizedArguments.filename ?? '');
    const offset = Number(plan.normalizedArguments.offset ?? 0);
    const maxChars = Number(plan.normalizedArguments.maxChars ?? 8_000);
    const read = await this.indexedFiles.readWithSync(owner, { filename });
    if (read.ok === false) {
      return {
        schemaVersion: 'tool-result/1',
        operationId: plan.operationId,
        toolCallId: plan.toolCallId,
        status: 'failed',
        content: '',
        structuredContent: read,
        artifactRefs: [],
        sourceRefs: [],
        effects: [],
        error: {
          code: `workspace_file_${read.error}`,
          message: `The working-folder file could not be read: ${read.error}`,
          retryable: read.error === 'not_ready',
        },
      };
    }
    const content = read.content.slice(offset, offset + maxChars);
    const nextOffset = offset + content.length;
    return {
      schemaVersion: 'tool-result/1',
      operationId: plan.operationId,
      toolCallId: plan.toolCallId,
      status: 'succeeded',
      content,
      structuredContent: {
        indexedFileId: read.indexedFileId,
        filename: read.filename,
        mimeType: read.mimeType,
        size: read.size,
        mtime: read.mtime.toISOString(),
        offset,
        nextOffset,
        truncated: nextOffset < read.content.length,
      },
      artifactRefs: [],
      sourceRefs: [],
      effects: [],
      error: null,
    };
  }

  private executeSkillResourceLoad(plan: ToolPlanContract): ToolResultContract {
    const resource = resolveProductSkillResource({
      skillId: plan.normalizedArguments.skillId,
      skillVersion: plan.normalizedArguments.skillVersion,
      skillContentHash: plan.normalizedArguments.skillContentHash,
      resourceId: plan.normalizedArguments.resourceId,
      resourceContentHash: plan.normalizedArguments.resourceContentHash,
    });
    if (!resource) throw new Error('skill_resource_integrity_mismatch');
    return {
      schemaVersion: 'tool-result/1',
      operationId: plan.operationId,
      toolCallId: plan.toolCallId,
      status: 'succeeded',
      content: resource.content,
      structuredContent: {
        schemaVersion: 'skill-resource/1',
        skillId: resource.skillId,
        skillVersion: resource.skillVersion,
        resourceId: resource.resourceId,
        contentHash: resource.contentHash,
      },
      artifactRefs: [],
      sourceRefs: [
        `product-skill:${resource.skillVersion}:${resource.resourceId}:${resource.contentHash}`,
      ],
      effects: [],
      error: null,
    };
  }

  private async executeWorkspaceFileList(
    plan: ToolPlanContract,
  ): Promise<ToolResultContract> {
    const owner = await this.workspaceOwner(plan);
    const offset = Number(plan.normalizedArguments.offset ?? 0);
    const limit = Number(plan.normalizedArguments.limit ?? 100);
    const reconciliation = await this.indexedFiles.scanFolder(owner);
    if (reconciliation.status !== 'done') {
      return {
        schemaVersion: 'tool-result/1',
        operationId: plan.operationId,
        toolCallId: plan.toolCallId,
        status: 'failed',
        content: '',
        structuredContent: reconciliation,
        artifactRefs: [],
        sourceRefs: [],
        effects: [],
        error: {
          code: `workspace_${reconciliation.status}`,
          message: 'The configured working folder is not available',
          retryable: reconciliation.status === 'folder_missing',
        },
      };
    }
    const allFiles = await this.indexedFiles.findByOwner(owner);
    const files = allFiles.slice(offset, offset + limit).map((file) => ({
      filename: file.filename,
      mimeType: file.mimeType,
      size: Number(file.size),
      mtime: file.mtime.toISOString(),
    }));
    const nextOffset = offset + files.length;
    return {
      schemaVersion: 'tool-result/1',
      operationId: plan.operationId,
      toolCallId: plan.toolCallId,
      status: 'succeeded',
      content: files
        .map((file) => file.filename)
        .join('\n')
        .slice(0, 8_000),
      structuredContent: {
        files,
        count: files.length,
        total: allFiles.length,
        offset,
        nextOffset: nextOffset < allFiles.length ? nextOffset : null,
        reconciliation,
      },
      artifactRefs: [],
      sourceRefs: [],
      effects: [],
      error: null,
    };
  }

  private async executeWorkspaceFileSearch(
    plan: ToolPlanContract,
  ): Promise<ToolResultContract> {
    const owner = await this.workspaceOwner(plan);
    const query = String(plan.normalizedArguments.query ?? '');
    const limit = Number(plan.normalizedArguments.limit ?? 10);
    const reconciliation = await this.indexedFiles.scanFolder(owner);
    if (reconciliation.status !== 'done') {
      return {
        schemaVersion: 'tool-result/1',
        operationId: plan.operationId,
        toolCallId: plan.toolCallId,
        status: 'failed',
        content: '',
        structuredContent: reconciliation,
        artifactRefs: [],
        sourceRefs: [],
        effects: [],
        error: {
          code: `workspace_${reconciliation.status}`,
          message: 'The configured working folder is not available',
          retryable: reconciliation.status === 'folder_missing',
        },
      };
    }
    const hits = await this.indexedFiles.search(owner, query, limit);
    return {
      schemaVersion: 'tool-result/1',
      operationId: plan.operationId,
      toolCallId: plan.toolCallId,
      status: 'succeeded',
      content: hits
        .map((hit) => `${hit.filename}\n${hit.snippet}`)
        .join('\n\n')
        .slice(0, 8_000),
      structuredContent: { hits, count: hits.length },
      artifactRefs: [],
      sourceRefs: [],
      effects: [],
      error: null,
    };
  }

  private async executeWorkspaceFileWrite(
    assignment: StepAssignment,
    plan: ToolPlanContract,
  ): Promise<ToolResultContract> {
    try {
      const observation = await this.runWorkspaceFileEffect(
        assignment,
        plan,
        false,
      );
      return this.workspaceObservationResult(
        assignment,
        plan,
        observation,
        observation.reason === 'execution_cancelled_before_effect',
      );
    } catch (error) {
      return this.unknownWorkspaceMutation(
        plan,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async executeWorkspaceFileDelete(
    assignment: StepAssignment,
    plan: ToolPlanContract,
  ): Promise<ToolResultContract> {
    try {
      const observation = await this.runWorkspaceFileEffect(
        assignment,
        plan,
        false,
      );
      return this.workspaceObservationResult(
        assignment,
        plan,
        observation,
        observation.reason === 'execution_cancelled_before_effect',
      );
    } catch (error) {
      return this.unknownWorkspaceMutation(
        plan,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async runWorkspaceFileEffect(
    assignment: StepAssignment,
    plan: ToolPlanContract,
    recoveryOnly: boolean,
  ): Promise<WorkspaceFileEffectObservation> {
    const operation =
      plan.toolName === WORKSPACE_FILE_WRITE_TOOL_NAME ? 'write' : 'delete';
    const owner = await this.workspaceOwner(plan);
    const filename = String(plan.normalizedArguments.filename ?? '');
    const body = this.workspaceWriteBody(plan);
    const intent = this.workspaceEffectInput(assignment, plan, operation, body);
    let state = await this.effectJournal.readExternal(intent);
    const effectWasPrepared = state !== null;
    if (!state) {
      let preparation: WorkspaceFileSnapshot;
      try {
        preparation = await this.observeWorkspaceFile(owner, filename);
      } catch (error) {
        if (!recoveryOnly) throw error;
        preparation = this.unavailableWorkspaceSnapshot(filename);
      }
      state = await this.effectJournal.prepareExternal(intent, preparation);
    }
    if (state.status !== 'prepared') {
      return state.observation as unknown as WorkspaceFileEffectObservation;
    }

    if (recoveryOnly && !effectWasPrepared) {
      const observation = this.workspaceObservation(
        operation,
        'not_applied',
        'workspace_effect_not_prepared',
        state.preparationObservation as unknown as WorkspaceFileSnapshot,
      );
      await this.effectJournal.recordExternalObservation(
        intent,
        observation,
        'continue',
      );
      return observation;
    }

    let current: WorkspaceFileSnapshot;
    try {
      current = await this.observeWorkspaceFile(owner, filename);
    } catch (error) {
      if (!recoveryOnly) throw error;
      current = this.unavailableWorkspaceSnapshot(filename);
    }
    let observation = this.classifyWorkspaceEffect(
      operation,
      plan,
      state,
      current,
      body,
    );
    const terminalWithoutApply =
      observation.effectStatus === 'applied' ||
      observation.effectStatus === 'inconclusive' ||
      observation.reason === 'workspace_file_exists' ||
      observation.reason === 'workspace_file_already_absent';
    if (terminalWithoutApply) {
      await this.effectJournal.recordExternalObservation(
        intent,
        observation,
        observation.effectStatus === 'inconclusive'
          ? 'inconclusive'
          : 'verified',
      );
      return observation;
    }
    if (recoveryOnly) {
      await this.effectJournal.recordExternalObservation(
        intent,
        observation,
        'continue',
      );
      return observation;
    }

    const control = await this.attempts.readAttemptControl(
      assignment.attemptId,
      LOCAL_TOOL_RUNTIME_WORKER_ID,
    );
    if (control.cancelled) {
      observation = {
        ...observation,
        effectStatus: 'not_applied',
        reason: 'execution_cancelled_before_effect',
      };
      await this.effectJournal.recordExternalObservation(
        intent,
        observation,
        'verified',
      );
      return observation;
    }
    if (control.leaseExpiresAt <= new Date()) {
      observation = {
        ...observation,
        effectStatus: 'not_applied',
        reason: 'lease_expired_before_effect',
      };
      await this.effectJournal.recordExternalObservation(
        intent,
        observation,
        'continue',
      );
      return observation;
    }

    if (operation === 'write') {
      await this.indexedFiles.writeFile(owner, filename, body!, {
        overwrite: plan.normalizedArguments.overwrite === true,
      });
    } else {
      await this.indexedFiles.deleteByFilename(owner, filename);
    }
    const after = await this.observeWorkspaceFile(owner, filename);
    observation = this.classifyWorkspaceEffect(
      operation,
      plan,
      state,
      after,
      body,
    );
    await this.effectJournal.recordExternalObservation(
      intent,
      observation,
      observation.effectStatus === 'inconclusive' ? 'inconclusive' : 'verified',
    );
    return observation;
  }

  private workspaceEffectInput(
    assignment: StepAssignment,
    plan: ToolPlanContract,
    operation: 'write' | 'delete',
    body: Buffer | null,
  ): VerifiedExecutionEffectInput {
    const effect = plan.effects[0];
    if (!effect || plan.effects.length !== 1) {
      throw new Error('workspace_effect_contract_invalid');
    }
    return {
      executionId: assignment.executionId,
      effectKey: `workspace-file:${assignment.operationId}`,
      effectType: `workspace_file_${operation}`,
      resourceKey: effect.resourceKey,
      intent: {
        schemaVersion: 'workspace-file-effect-intent/1',
        operation,
        ownerType: plan.normalizedArguments.ownerType,
        ownerId: plan.normalizedArguments.ownerId,
        scopeKey: plan.normalizedArguments.scopeKey,
        filename: plan.normalizedArguments.filename,
        overwrite:
          operation === 'write'
            ? plan.normalizedArguments.overwrite === true
            : false,
        contentHash: body ? contentHash(body) : null,
        size: body?.length ?? null,
      },
    };
  }

  private workspaceWriteBody(plan: ToolPlanContract): Buffer | null {
    if (plan.toolName !== WORKSPACE_FILE_WRITE_TOOL_NAME) return null;
    const content = plan.normalizedArguments.content;
    return typeof content === 'string'
      ? Buffer.from(content, 'utf8')
      : Buffer.from(
          String(plan.normalizedArguments.contentBase64 ?? ''),
          'base64',
        );
  }

  private async observeWorkspaceFile(
    owner: OwnerRef,
    filename: string,
  ): Promise<WorkspaceFileSnapshot> {
    const reconciliation = await this.indexedFiles.scanFolder(owner);
    if (reconciliation.status !== 'done') {
      throw new Error(`workspace_${reconciliation.status}`);
    }
    const file = await this.indexedFiles.getByFilename(owner, filename);
    if (!file) {
      return {
        schemaVersion: 'workspace-file-snapshot/1',
        filename,
        exists: false,
        indexedFileId: null,
        contentHash: null,
        size: null,
      };
    }
    const observed = await this.indexedFiles.readContent(file.id, owner);
    return {
      schemaVersion: 'workspace-file-snapshot/1',
      filename,
      exists: true,
      indexedFileId: file.id,
      contentHash: contentHash(observed.content),
      size: observed.content.length,
    };
  }

  private unavailableWorkspaceSnapshot(
    filename: string,
  ): WorkspaceFileSnapshot {
    return {
      schemaVersion: 'workspace-file-snapshot/1',
      filename,
      exists: null,
      indexedFileId: null,
      contentHash: null,
      size: null,
    };
  }

  private classifyWorkspaceEffect(
    operation: 'write' | 'delete',
    plan: ToolPlanContract,
    state: DurableExternalEffectState,
    current: WorkspaceFileSnapshot,
    body: Buffer | null,
  ): WorkspaceFileEffectObservation {
    const before =
      state.preparationObservation as unknown as WorkspaceFileSnapshot;
    if (current.exists === null || before.exists === null) {
      return this.workspaceObservation(
        operation,
        'inconclusive',
        'workspace_state_unavailable',
        current,
      );
    }
    if (operation === 'delete') {
      if (before.exists === false && current.exists === false) {
        return this.workspaceObservation(
          operation,
          'not_applied',
          'workspace_file_already_absent',
          current,
        );
      }
      if (before.exists === true && current.exists === false) {
        return this.workspaceObservation(
          operation,
          'applied',
          'workspace_file_absence_verified',
          current,
        );
      }
      if (this.sameWorkspaceSnapshot(before, current)) {
        return this.workspaceObservation(
          operation,
          'not_applied',
          'workspace_baseline_unchanged',
          current,
        );
      }
      return this.workspaceObservation(
        operation,
        'inconclusive',
        'workspace_file_changed_during_delete',
        current,
      );
    }

    const desiredHash = contentHash(body!);
    const overwrite = plan.normalizedArguments.overwrite === true;
    if (current.exists && current.contentHash === desiredHash) {
      if (!overwrite && before.exists) {
        return this.workspaceObservation(
          operation,
          'not_applied',
          'workspace_file_exists',
          current,
        );
      }
      return this.workspaceObservation(
        operation,
        'applied',
        'workspace_file_content_verified',
        current,
      );
    }
    if (!overwrite && before.exists) {
      return this.workspaceObservation(
        operation,
        'not_applied',
        'workspace_file_exists',
        current,
      );
    }
    if (this.sameWorkspaceSnapshot(before, current)) {
      return this.workspaceObservation(
        operation,
        'not_applied',
        'workspace_baseline_unchanged',
        current,
      );
    }
    return this.workspaceObservation(
      operation,
      'inconclusive',
      'workspace_file_changed_during_write',
      current,
    );
  }

  private sameWorkspaceSnapshot(
    left: WorkspaceFileSnapshot,
    right: WorkspaceFileSnapshot,
  ): boolean {
    return (
      left.exists === right.exists &&
      left.contentHash === right.contentHash &&
      left.size === right.size
    );
  }

  private workspaceObservation(
    operation: 'write' | 'delete',
    effectStatus: WorkspaceFileEffectObservation['effectStatus'],
    reason: string,
    file: WorkspaceFileSnapshot,
  ): WorkspaceFileEffectObservation {
    return {
      schemaVersion: 'workspace-file-effect-observation/1',
      operation,
      effectStatus,
      reason,
      file,
    };
  }

  private async workspaceObservationResult(
    assignment: StepAssignment,
    plan: ToolPlanContract,
    observation: WorkspaceFileEffectObservation,
    cancellationRequested: boolean,
  ): Promise<ToolResultContract> {
    const effectStatus = observation.effectStatus;
    if (effectStatus === 'inconclusive') {
      return this.unknownWorkspaceMutation(plan, observation.reason);
    }
    if (cancellationRequested && effectStatus === 'not_applied') {
      return {
        schemaVersion: 'tool-result/1',
        operationId: assignment.operationId,
        toolCallId: plan.toolCallId,
        status: 'cancelled',
        content: '',
        structuredContent: observation,
        artifactRefs: [],
        sourceRefs: [],
        effects: plan.effects.map((effect) => ({
          effectClass: effect.effectClass,
          resourceKey: effect.resourceKey,
          status: 'not_applied' as const,
        })),
        error: {
          code: 'execution_cancelled',
          message: 'The execution was cancelled before the file effect',
          retryable: false,
        },
      };
    }
    if (observation.reason === 'workspace_file_exists') {
      return {
        schemaVersion: 'tool-result/1',
        operationId: assignment.operationId,
        toolCallId: plan.toolCallId,
        status: 'failed',
        content: '',
        structuredContent: observation,
        artifactRefs: [],
        sourceRefs: [],
        effects: plan.effects.map((effect) => ({
          effectClass: effect.effectClass,
          resourceKey: effect.resourceKey,
          status: 'not_applied' as const,
        })),
        error: {
          code: 'workspace_file_exists',
          message: 'The file already exists and overwrite was not authorized',
          retryable: false,
        },
      };
    }
    const filename = String(plan.normalizedArguments.filename ?? '');
    const writeAction =
      plan.normalizedArguments.overwrite === true ? 'Updated' : 'Created';
    return {
      schemaVersion: 'tool-result/1',
      operationId: assignment.operationId,
      toolCallId: plan.toolCallId,
      status: 'succeeded',
      content:
        observation.operation === 'delete'
          ? effectStatus === 'applied'
            ? `Deleted file: ${filename}`
            : `File already absent: ${filename}`
          : `${writeAction} file: ${filename}`,
      structuredContent: observation,
      artifactRefs: [],
      sourceRefs: [],
      effects: plan.effects.map((effect) => ({
        effectClass: effect.effectClass,
        resourceKey: effect.resourceKey,
        status: effectStatus,
      })),
      error: null,
    };
  }

  private unknownWorkspaceMutation(
    plan: ToolPlanContract,
    message: string,
  ): ToolResultContract {
    return {
      schemaVersion: 'tool-result/1',
      operationId: plan.operationId,
      toolCallId: plan.toolCallId,
      status: 'unknown',
      content: '',
      structuredContent: null,
      artifactRefs: [],
      sourceRefs: [],
      effects: plan.effects.map((effect) => ({
        effectClass: effect.effectClass,
        resourceKey: effect.resourceKey,
        status: 'inconclusive' as const,
      })),
      error: {
        code: 'effect_unknown',
        message,
        retryable: false,
      },
    };
  }

  private async workspaceOwner(plan: ToolPlanContract): Promise<OwnerRef> {
    const ownerType = plan.normalizedArguments.ownerType;
    const ownerId = Number(plan.normalizedArguments.ownerId);
    const scopeKey = plan.normalizedArguments.scopeKey;
    if (
      !['assistant', 'agent'].includes(String(ownerType)) ||
      !Number.isInteger(ownerId) ||
      ownerId <= 0 ||
      typeof scopeKey !== 'string' ||
      !/^[0-9a-f]{32}$/.test(scopeKey)
    ) {
      throw new Error('tool_plan_not_executable');
    }
    const owner = { ownerType: ownerType as OwnerRef['ownerType'], ownerId };
    const currentScopeKey = await this.indexedFiles.folderScopeKey(owner);
    if (currentScopeKey !== scopeKey) {
      throw new ConflictException('working_folder_scope_changed');
    }
    return owner;
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
      child.taskType !== 'delegated-agent' ||
      (child.payload as DelegatedAgentExecutionPayload)
        .delegationOperationId !== plan.operationId
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

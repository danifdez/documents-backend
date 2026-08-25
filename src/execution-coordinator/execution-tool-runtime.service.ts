import { Inject, Injectable, Logger } from '@nestjs/common';
import { ExecutionAttemptService } from '../execution/execution-attempt.service';
import { ExecutionContractValidator } from '../execution/execution-contract-validator';
import { StepAssignment } from '../execution/execution-control-plane.types';
import { ExecutionStepKind } from '../execution/execution-step-kind.enum';
import {
  DOCUMENT_SEARCH_TOOL_CAPABILITY,
  DOCUMENT_SEARCH_TOOL_NAME,
  DOCUMENT_SEARCH_TOOL_VERSION,
} from '../execution/execution-tool.constants';
import {
  ToolPlanContract,
  ToolResultContract,
} from '../execution/execution-tool.types';
import { SearchResultDto } from '../search/dto/search-result.dto';
import { BACKEND_RUNTIME_FINGERPRINT } from '../execution/execution-runtime';

const TOOL_RUNTIME_WORKER_ID = '00000000-0000-4000-8000-000000000001';
const TOOL_LEASE_MS = 30_000;
export const DOCUMENT_SEARCH_PROVIDER = Symbol('DOCUMENT_SEARCH_PROVIDER');

export interface DocumentSearchProvider {
  globalSearch(query: string): Promise<SearchResultDto[]>;
}

@Injectable()
export class ExecutionToolRuntimeService {
  private readonly logger = new Logger(ExecutionToolRuntimeService.name);

  constructor(
    private readonly attempts: ExecutionAttemptService,
    private readonly contracts: ExecutionContractValidator,
    @Inject(DOCUMENT_SEARCH_PROVIDER)
    private readonly search: DocumentSearchProvider,
  ) {}

  async executeReady(limit = 20): Promise<number> {
    let executed = 0;
    while (executed < limit) {
      const assignment = await this.attempts.claimReadyStep({
        workerId: TOOL_RUNTIME_WORKER_ID,
        stepKinds: [ExecutionStepKind.TOOL],
        capabilities: [DOCUMENT_SEARCH_TOOL_CAPABILITY],
        leaseDurationMs: TOOL_LEASE_MS,
      });
      if (!assignment) break;
      await this.executeAssignment(assignment);
      executed += 1;
    }
    return executed;
  }

  private async executeAssignment(assignment: StepAssignment): Promise<void> {
    const plan = this.readPlan(assignment);
    await this.attempts.startAttempt(
      assignment.attemptId,
      TOOL_RUNTIME_WORKER_ID,
    );

    let result: ToolResultContract;
    try {
      result = await this.executeDocumentsSearch(plan);
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
          message: 'The document search could not be completed',
          retryable: true,
        },
      };
    }
    this.contracts.assertToolResult(
      result as unknown as Record<string, unknown>,
    );
    const status =
      result.status === 'succeeded'
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

  private readPlan(assignment: StepAssignment): ToolPlanContract {
    const plan = assignment.work.toolPlan as ToolPlanContract | undefined;
    if (!plan) throw new Error('tool_plan_missing');
    this.contracts.assertToolPlan(plan as unknown as Record<string, unknown>);
    if (
      plan.operationId !== assignment.operationId ||
      plan.toolName !== DOCUMENT_SEARCH_TOOL_NAME ||
      plan.descriptorVersion !== DOCUMENT_SEARCH_TOOL_VERSION ||
      plan.policyDecision.decision !== 'allowed' ||
      plan.confirmationRequirement !== null ||
      plan.effects.length !== 0
    ) {
      throw new Error('tool_plan_not_executable');
    }
    return plan;
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

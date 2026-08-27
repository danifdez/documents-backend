import { Injectable, Logger } from '@nestjs/common';
import { ExecutionEntity } from '../../execution/execution.entity';
import { ExecutionService } from '../../execution/execution.service';
import { ExecutionCompletion } from '../../execution/execution.types';
import { executionPayloadOwnerId } from '../../execution/execution-task-payload.types';
import { ExecutionProcessor } from '../execution-processor.interface';

type ChatExecutionResult = {
  reply?: string;
  error?: string | null;
  completionKind?: ExecutionCompletion['kind'];
  completionReason?: string;
  completionSource?: ExecutionCompletion['source'];
  partialResult?: ExecutionCompletion['partialResult'];
};

@Injectable()
export class AssistantChatProcessor implements ExecutionProcessor {
  private readonly logger = new Logger(AssistantChatProcessor.name);
  private readonly taskTypes = new Set([
    'assistant-chat',
    'agent-chat',
    'delegated-agent',
  ]);

  constructor(private readonly executionService: ExecutionService) {}

  canProcess(taskType: string): boolean {
    return this.taskTypes.has(taskType);
  }

  async process(execution: ExecutionEntity): Promise<{ success: boolean }> {
    if (execution.taskType === 'delegated-agent') {
      return this.processDelegated(execution);
    }
    if (execution.taskType === 'agent-chat') {
      return this.processAgent(execution);
    }
    return this.processAssistant(execution);
  }

  private async processDelegated(
    execution: ExecutionEntity,
  ): Promise<{ success: boolean }> {
    const reply =
      typeof execution.result === 'string'
        ? execution.result
        : (this.result(execution).reply ?? '');
    const error =
      execution.error && typeof execution.error.message === 'string'
        ? execution.error.message
        : null;
    await this.executionService.completeExecution(
      execution.executionId,
      reply,
      error,
      undefined,
      {
        socketEvent: 'executionDelegationCompleted',
        payload: {
          executionId: execution.executionId,
          parentExecutionId: execution.parentExecutionId,
          status: error ? 'failed' : 'completed',
        },
      },
    );
    return { success: !error };
  }

  private async processAssistant(
    execution: ExecutionEntity,
  ): Promise<{ success: boolean }> {
    const assistantId = executionPayloadOwnerId(execution.payload);
    if (!assistantId) {
      this.logger.error(
        `Execution ${execution.executionId} missing ownerId in payload`,
      );
      return { success: false };
    }
    const result = this.result(execution);
    const reply = result.reply ?? '';
    const error = result.error ?? null;
    await this.finalizeExecution(execution, reply, error, result);
    return { success: true };
  }

  private async processAgent(
    execution: ExecutionEntity,
  ): Promise<{ success: boolean }> {
    const agentId = executionPayloadOwnerId(execution.payload);
    if (!agentId) {
      this.logger.error(
        `Execution ${execution.executionId} missing ownerId in payload`,
      );
      return { success: false };
    }
    const result = this.result(execution);
    const reply = result.reply ?? '';
    const error = result.error ?? null;
    await this.finalizeExecution(execution, reply, error, result);
    return { success: true };
  }

  private result(execution: ExecutionEntity): ChatExecutionResult {
    if (!execution.result || typeof execution.result !== 'object') return {};
    return execution.result as ChatExecutionResult;
  }

  private async finalizeExecution(
    execution: ExecutionEntity,
    reply: string,
    error: string | null,
    result: ChatExecutionResult,
  ): Promise<void> {
    const completion = this.completion(result);
    if (completion?.source === 'runtime_template') {
      await this.executionService.validateDeterministicPartial(
        execution.executionId,
        reply,
        error,
        completion,
      );
    }
    await this.executionService.completeExecution(
      execution.executionId,
      reply,
      error,
      completion,
    );
  }

  private completion(
    result: ChatExecutionResult,
  ): ExecutionCompletion | undefined {
    if (!result.completionKind && !result.completionReason) return undefined;
    return {
      kind: result.completionKind,
      reason: result.completionReason,
      ...(result.completionSource ? { source: result.completionSource } : {}),
      ...(result.partialResult ? { partialResult: result.partialResult } : {}),
    };
  }
}

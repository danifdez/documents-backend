import { Injectable, Logger } from '@nestjs/common';
import { AgentService } from '../../agent/agent.service';
import { toAgentMessageDto } from '../../agent/dto/agent.dto';
import { AssistantService } from '../../assistant/assistant.service';
import { ExecutionEntity } from '../../execution/execution.entity';
import { ExecutionService } from '../../execution/execution.service';
import { ExecutionCompletion } from '../../execution/execution.types';
import { ExecutionPublication } from '../../execution-outbox/execution-publication';
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
  private readonly taskTypes = new Set(['assistant-chat', 'agent-chat']);

  constructor(
    private readonly assistantService: AssistantService,
    private readonly agentService: AgentService,
    private readonly executionService: ExecutionService,
  ) {}

  canProcess(taskType: string): boolean {
    return this.taskTypes.has(taskType);
  }

  async process(execution: ExecutionEntity): Promise<{ success: boolean }> {
    if (execution.taskType === 'agent-chat') {
      return this.processAgent(execution);
    }
    return this.processAssistant(execution);
  }

  private async processAssistant(
    execution: ExecutionEntity,
  ): Promise<{ success: boolean }> {
    const assistantId = execution.payload?.ownerId as number | undefined;
    if (!assistantId) {
      this.logger.error(
        `Execution ${execution.executionId} missing ownerId in payload`,
      );
      return { success: false };
    }
    const result = this.result(execution);
    const reply = result.reply ?? '';
    const error = result.error ?? null;
    const message = await this.assistantService.recordAssistantReply(
      assistantId,
      reply,
      execution.executionId,
      error,
    );
    await this.finalizeExecution(execution, reply, error, result, {
      socketEvent: 'assistantResponse',
      payload: { assistantId, executionId: execution.executionId, message },
    });
    return { success: true };
  }

  private async processAgent(
    execution: ExecutionEntity,
  ): Promise<{ success: boolean }> {
    const agentId = execution.payload?.ownerId as number | undefined;
    if (!agentId) {
      this.logger.error(
        `Execution ${execution.executionId} missing ownerId in payload`,
      );
      return { success: false };
    }
    const result = this.result(execution);
    const reply = result.reply ?? '';
    const error = result.error ?? null;
    const message = await this.agentService.recordAgentReply(
      agentId,
      reply,
      execution.executionId,
      error,
    );
    await this.finalizeExecution(execution, reply, error, result, {
      socketEvent: 'agentResponse',
      payload: {
        agentId,
        executionId: execution.executionId,
        message: toAgentMessageDto(message),
      },
    });
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
    publication: ExecutionPublication,
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
      publication,
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

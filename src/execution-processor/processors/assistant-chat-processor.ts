import { Injectable, Logger } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { NotificationGateway } from '../../notification/notification.gateway';
import { ExecutionEntity } from '../../execution/execution.entity';
import { ExecutionService } from '../../execution/execution.service';
import { ExecutionPriority } from '../../execution/execution-priority.enum';
import { ExecutionStatus } from '../../execution/execution-status.enum';
import { AssistantService } from '../../assistant/assistant.service';
import { AssistantMemoryService } from '../../assistant-memory/assistant-memory.service';
import { MemoryEntryType } from '../../assistant-memory/memory-entry.entity';
import { AgentService } from '../../agent/agent.service';
import { toAgentMessageDto } from '../../agent/dto/agent.dto';
import { ExecutionTelemetrySummary } from '../../execution/execution.types';

const VALID_MEMORY_TYPES: MemoryEntryType[] = [
  'fact',
  'episode',
  'instruction',
];

@Injectable()
export class AssistantChatProcessor implements ExecutionProcessor {
  private readonly logger = new Logger(AssistantChatProcessor.name);
  private readonly TASK_TYPES = new Set(['assistant-chat', 'agent-chat']);
  private readonly DEDUP_THRESHOLD: number;

  constructor(
    private readonly notificationGateway: NotificationGateway,
    private readonly assistantService: AssistantService,
    private readonly memoryService: AssistantMemoryService,
    private readonly agentService: AgentService,
    private readonly executionService: ExecutionService,
  ) {
    const raw = process.env.MEMORY_DEDUP_THRESHOLD ?? '0.92';
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed)) {
      this.logger.warn(
        `Invalid MEMORY_DEDUP_THRESHOLD=${raw}; falling back to 0.92`,
      );
      this.DEDUP_THRESHOLD = 0.92;
    } else {
      this.DEDUP_THRESHOLD = parsed;
    }
  }

  private async findDedupCandidate(
    assistantId: number,
    body: string,
    timeoutMs = 2000,
  ): Promise<{ memoryId: number; score: number } | null> {
    const q = (body ?? '').trim();
    if (!q) return null;
    let execution;
    try {
      execution = await this.executionService.create(
        'memory-search',
        ExecutionPriority.HIGH,
        {
          ownerId: assistantId,
          query: q,
          limit: 1,
        },
      );
    } catch (e: any) {
      this.logger.warn(`dedup search enqueue failed: ${e?.message ?? e}`);
      return null;
    }
    if (!execution) return null;

    const start = Date.now();
    const poll = 100;
    while (Date.now() - start < timeoutMs) {
      const current = (await this.executionService.findOne(
        execution.executionId,
      )) as ExecutionEntity | null;
      if (!current) return null;
      if (current.status === ExecutionStatus.COMPLETED) {
        const r = current.result as {
          results?: Array<{ memoryId: number; score: number }>;
        } | null;
        const top = r?.results?.[0];
        return top && Number.isFinite(top.score) ? top : null;
      }
      if (current.status === ExecutionStatus.FAILED) return null;
      await new Promise((resolve) => setTimeout(resolve, poll));
    }
    this.logger.warn(
      `dedup search execution ${execution.executionId} timed out`,
    );
    return null;
  }

  canProcess(taskType: string): boolean {
    return this.TASK_TYPES.has(taskType);
  }

  async process(execution: ExecutionEntity): Promise<any> {
    const kind =
      (execution.payload?.['kind'] as string | undefined) ?? 'assistant';
    if (kind === 'agent') {
      return this.processAgent(execution);
    }
    return this.processAssistant(execution);
  }

  private async processAssistant(execution: ExecutionEntity): Promise<any> {
    const assistantId = execution.payload?.['ownerId'] as number | undefined;
    if (!assistantId) {
      this.logger.error(
        `Execution ${execution.executionId} missing ownerId in payload`,
      );
      return { success: false };
    }

    const result = execution.result || {};
    const reply = (result['reply'] as string | undefined) ?? '';
    const error = (result['error'] as string | undefined) ?? null;

    const eventMessages: any[] = [];

    const memoryAction = result['memoryAction'];
    if (memoryAction && typeof memoryAction === 'object') {
      const action = String(memoryAction['action'] ?? '').toLowerCase();
      try {
        if (action === 'save') {
          const save = memoryAction['save'] as Record<string, any> | undefined;
          const name = String(save?.['name'] ?? '').trim();
          const body = String(save?.['body'] ?? '').trim();
          const rawType = String(save?.['type'] ?? 'fact')
            .trim()
            .toLowerCase();
          const type = (
            VALID_MEMORY_TYPES.includes(rawType as MemoryEntryType)
              ? rawType
              : 'fact'
          ) as MemoryEntryType;
          if (name && body) {
            const candidate = await this.findDedupCandidate(assistantId, body);
            if (candidate && candidate.score >= this.DEDUP_THRESHOLD) {
              try {
                const entry = await this.memoryService.update(
                  assistantId,
                  candidate.memoryId,
                  { name, type, body },
                );
                const eventMsg = await this.assistantService.recordEvent(
                  assistantId,
                  `Memory updated: ${entry.name}`,
                  {
                    kind: 'memory_replaced',
                    entry,
                    previousId: candidate.memoryId,
                    via: 'auto_dedup',
                    score: candidate.score,
                  },
                );
                eventMessages.push(eventMsg);
              } catch (e: any) {
                this.logger.warn(
                  `Execution ${execution.executionId} auto-dedup replace failed for memory ${candidate.memoryId}: ${e?.message ?? e}`,
                );
              }
            } else {
              const entry = await this.memoryService.create(assistantId, {
                name,
                type,
                body,
              });
              const eventMsg = await this.assistantService.recordEvent(
                assistantId,
                `Memory saved: ${entry.name}`,
                { kind: 'memory_saved', entry },
              );
              eventMessages.push(eventMsg);
            }
          }
        } else if (action === 'replace') {
          const replaceId = Number(memoryAction['replace_id']);
          const save = memoryAction['save'] as Record<string, any> | undefined;
          const name = String(save?.['name'] ?? '').trim();
          const body = String(save?.['body'] ?? '').trim();
          const rawType = String(save?.['type'] ?? 'fact')
            .trim()
            .toLowerCase();
          const type = (
            VALID_MEMORY_TYPES.includes(rawType as MemoryEntryType)
              ? rawType
              : 'fact'
          ) as MemoryEntryType;
          if (Number.isInteger(replaceId) && name && body) {
            try {
              const entry = await this.memoryService.update(
                assistantId,
                replaceId,
                {
                  name,
                  type,
                  body,
                },
              );
              const eventMsg = await this.assistantService.recordEvent(
                assistantId,
                `Memory updated: ${entry.name}`,
                {
                  kind: 'memory_replaced',
                  entry,
                  previousId: replaceId,
                  via: 'llm',
                },
              );
              eventMessages.push(eventMsg);
            } catch (e: any) {
              this.logger.warn(
                `Execution ${execution.executionId} replace failed for memory ${replaceId}: ${e?.message ?? e}`,
              );
            }
          }
        } else if (action === 'forget') {
          const forgetId = Number(memoryAction['forget_id']);
          if (Number.isInteger(forgetId)) {
            const entry = await this.memoryService.findOwned(
              assistantId,
              forgetId,
            );
            if (entry) {
              await this.memoryService.remove(assistantId, forgetId);
              const eventMsg = await this.assistantService.recordEvent(
                assistantId,
                `Memory forgotten: ${entry.name}`,
                {
                  kind: 'memory_forgotten',
                  entry: {
                    id: entry.id,
                    name: entry.name,
                    type: entry.type,
                    body: entry.body,
                  },
                },
              );
              eventMessages.push(eventMsg);
            }
          }
        }
      } catch (e: any) {
        this.logger.error(
          `Execution ${execution.executionId} failed memory action (${action}): ${e?.message ?? e}`,
        );
      }
    }

    const message = await this.assistantService.recordAssistantReply(
      assistantId,
      reply,
      execution.executionId,
      error,
    );

    await this.finalizeExecution(execution, reply, error, result);

    this.notificationGateway.sendAssistantResponse({
      assistantId,
      executionId: execution.executionId,
      eventMessages,
      message,
    });

    return { success: true };
  }

  private async processAgent(execution: ExecutionEntity): Promise<any> {
    const agentId = execution.payload?.['ownerId'] as number | undefined;
    if (!agentId) {
      this.logger.error(
        `Execution ${execution.executionId} missing ownerId in payload`,
      );
      return { success: false };
    }

    const result = execution.result || {};
    const reply = (result['reply'] as string | undefined) ?? '';
    const error = (result['error'] as string | undefined) ?? null;

    const message = await this.agentService.recordAgentReply(
      agentId,
      reply,
      execution.executionId,
      error,
    );

    await this.finalizeExecution(execution, reply, error, result);

    this.notificationGateway.sendAgentResponse({
      agentId,
      executionId: execution.executionId,
      message: toAgentMessageDto(message),
    });

    return { success: true };
  }

  private async finalizeExecution(
    execution: ExecutionEntity,
    reply: string,
    error: string | null,
    result: Record<string, any>,
  ): Promise<void> {
    await this.executionService.completeExecution(
      execution.executionId,
      reply,
      error,
      result['executionTelemetry'] as ExecutionTelemetrySummary | undefined,
    );
  }
}

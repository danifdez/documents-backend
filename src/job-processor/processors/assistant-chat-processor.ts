import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { NotificationGateway } from 'src/notification/notification.gateway';
import { JobEntity } from 'src/job/job.entity';
import { AssistantService } from 'src/assistant/assistant.service';
import { AssistantMemoryService } from 'src/assistant-memory/assistant-memory.service';
import { MemoryEntryType } from 'src/assistant-memory/memory-entry.entity';
import { AgentService } from 'src/agent/agent.service';
import { toAgentMessageDto } from 'src/agent/dto/agent.dto';

const VALID_MEMORY_TYPES: MemoryEntryType[] = [
  'fact', 'event', 'instruction',
];

@Injectable()
export class AssistantChatProcessor implements JobProcessor {
  private readonly logger = new Logger(AssistantChatProcessor.name);
  private readonly JOB_TYPE = 'assistant-chat';

  constructor(
    private readonly notificationGateway: NotificationGateway,
    private readonly assistantService: AssistantService,
    private readonly memoryService: AssistantMemoryService,
    private readonly agentService: AgentService,
  ) {}

  canProcess(jobType: string): boolean {
    return jobType === this.JOB_TYPE;
  }

  async process(job: JobEntity): Promise<any> {
    const kind = (job.payload?.['kind'] as string | undefined) ?? 'assistant';
    if (kind === 'agent') {
      return this.processAgent(job);
    }
    return this.processAssistant(job);
  }

  private async processAssistant(job: JobEntity): Promise<any> {
    const assistantId = job.payload?.['assistantId'] as number | undefined;
    if (!assistantId) {
      this.logger.error(`Job ${job.id} missing assistantId in payload`);
      return { success: false };
    }

    const result = job.result || {};
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
          const rawType = String(save?.['type'] ?? 'fact').trim().toLowerCase();
          const type = (VALID_MEMORY_TYPES.includes(rawType as MemoryEntryType)
            ? rawType
            : 'fact') as MemoryEntryType;
          if (name && body) {
            const entry = await this.memoryService.create(assistantId, { name, type, body });
            const eventMsg = await this.assistantService.recordEvent(
              assistantId,
              `Memory saved: ${entry.name}`,
              { kind: 'memory_saved', entry },
            );
            eventMessages.push(eventMsg);
          }
        } else if (action === 'forget') {
          const forgetId = Number(memoryAction['forget_id']);
          if (Number.isInteger(forgetId)) {
            const entry = await this.memoryService.findOwned(assistantId, forgetId);
            if (entry) {
              await this.memoryService.remove(assistantId, forgetId);
              const eventMsg = await this.assistantService.recordEvent(
                assistantId,
                `Memory forgotten: ${entry.name}`,
                {
                  kind: 'memory_forgotten',
                  entry: { id: entry.id, name: entry.name, type: entry.type, body: entry.body },
                },
              );
              eventMessages.push(eventMsg);
            }
          }
        }
      } catch (e: any) {
        this.logger.error(`Job ${job.id} failed memory action (${action}): ${e?.message ?? e}`);
      }
    }

    const message = await this.assistantService.recordAssistantReply(
      assistantId,
      reply,
      job.id,
      error,
    );

    this.notificationGateway.sendAssistantResponse({
      assistantId,
      jobId: job.id,
      eventMessages,
      message,
    });

    return { success: true };
  }

  private async processAgent(job: JobEntity): Promise<any> {
    const agentId =
      (job.payload?.['agentId'] as number | undefined)
      ?? (job.payload?.['ownerId'] as number | undefined);
    if (!agentId) {
      this.logger.error(`Job ${job.id} missing agentId in payload`);
      return { success: false };
    }

    const result = job.result || {};
    const reply = (result['reply'] as string | undefined) ?? '';
    const error = (result['error'] as string | undefined) ?? null;

    const message = await this.agentService.recordAgentReply(
      agentId,
      reply,
      job.id,
      error,
    );

    this.notificationGateway.sendAgentResponse({
      agentId,
      jobId: job.id,
      message: toAgentMessageDto(message),
    });

    return { success: true };
  }
}

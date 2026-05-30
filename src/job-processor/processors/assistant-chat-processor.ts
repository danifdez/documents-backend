import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { NotificationGateway } from 'src/notification/notification.gateway';
import { JobEntity } from 'src/job/job.entity';
import { JobService } from 'src/job/job.service';
import { JobPriority } from 'src/job/job-priority.enum';
import { JobStatus } from 'src/job/job-status.enum';
import { AssistantService } from 'src/assistant/assistant.service';
import { AssistantMemoryService } from 'src/assistant-memory/assistant-memory.service';
import { MemoryEntryType } from 'src/assistant-memory/memory-entry.entity';
import { AgentService } from 'src/agent/agent.service';
import { toAgentMessageDto } from 'src/agent/dto/agent.dto';

const VALID_MEMORY_TYPES: MemoryEntryType[] = [
  'fact', 'episode', 'instruction',
];

@Injectable()
export class AssistantChatProcessor implements JobProcessor {
  private readonly logger = new Logger(AssistantChatProcessor.name);
  private readonly JOB_TYPE = 'assistant-chat';
  private readonly DEDUP_THRESHOLD: number;

  constructor(
    private readonly notificationGateway: NotificationGateway,
    private readonly assistantService: AssistantService,
    private readonly memoryService: AssistantMemoryService,
    private readonly agentService: AgentService,
    private readonly jobService: JobService,
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
    let job;
    try {
      job = await this.jobService.create('memory-search', JobPriority.HIGH, {
        assistantId,
        query: q,
        limit: 1,
      });
    } catch (e: any) {
      this.logger.warn(`dedup search enqueue failed: ${e?.message ?? e}`);
      return null;
    }
    if (!job) return null;

    const start = Date.now();
    const poll = 100;
    while (Date.now() - start < timeoutMs) {
      const current = (await this.jobService.findOne(job.id)) as JobEntity | null;
      if (!current) return null;
      if (current.status === JobStatus.COMPLETED) {
        const r = current.result as
          | { results?: Array<{ memoryId: number; score: number }> }
          | null;
        const top = r?.results?.[0];
        return top && Number.isFinite(top.score) ? top : null;
      }
      if (current.status === JobStatus.FAILED) return null;
      await new Promise((resolve) => setTimeout(resolve, poll));
    }
    this.logger.warn(`dedup search job ${job.id} timed out`);
    return null;
  }

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
                  `Job ${job.id} auto-dedup replace failed for memory ${candidate.memoryId}: ${e?.message ?? e}`,
                );
              }
            } else {
              const entry = await this.memoryService.create(assistantId, { name, type, body });
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
          const rawType = String(save?.['type'] ?? 'fact').trim().toLowerCase();
          const type = (VALID_MEMORY_TYPES.includes(rawType as MemoryEntryType)
            ? rawType
            : 'fact') as MemoryEntryType;
          if (Number.isInteger(replaceId) && name && body) {
            try {
              const entry = await this.memoryService.update(assistantId, replaceId, {
                name,
                type,
                body,
              });
              const eventMsg = await this.assistantService.recordEvent(
                assistantId,
                `Memory updated: ${entry.name}`,
                { kind: 'memory_replaced', entry, previousId: replaceId, via: 'llm' },
              );
              eventMessages.push(eventMsg);
            } catch (e: any) {
              this.logger.warn(
                `Job ${job.id} replace failed for memory ${replaceId}: ${e?.message ?? e}`,
              );
            }
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

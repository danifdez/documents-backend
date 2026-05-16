import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { NotificationGateway } from 'src/notification/notification.gateway';
import { JobEntity } from 'src/job/job.entity';
import { AssistantService } from 'src/assistant/assistant.service';
import { AssistantMemoryService } from 'src/assistant-memory/assistant-memory.service';
import { MemoryEntryType } from 'src/assistant-memory/memory-entry.entity';

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
  ) {}

  canProcess(jobType: string): boolean {
    return jobType === this.JOB_TYPE;
  }

  async process(job: JobEntity): Promise<any> {
    const assistantId = job.payload?.['assistantId'] as number | undefined;
    if (!assistantId) {
      this.logger.error(`Job ${job.id} missing assistantId in payload`);
      return { success: false };
    }

    const result = job.result || {};
    const reply = (result['reply'] as string | undefined) ?? '';
    const error = (result['error'] as string | undefined) ?? null;

    // Persist any side-effect events (tool executed, memory saved/forgotten,
    // …) BEFORE the assistant reply, so the UI renders them in causal order.
    const eventMessages: any[] = [];

    // Tool events are emitted LIVE by the worker via POST /tool-event during
    // execution (so the UI shows "Buscando…" the moment the tool runs), so we
    // do NOT re-emit them here. The worker no longer returns `toolEvents`.

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
            // Capture metadata BEFORE deletion so the event card can still show it.
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
}

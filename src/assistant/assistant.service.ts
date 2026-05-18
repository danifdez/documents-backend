import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Inject, forwardRef, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AssistantEntity } from './assistant.entity';
import { AssistantMessageEntity } from './assistant-message.entity';
import { CreateAssistantDto, UpdateAssistantDto } from './dto/assistant.dto';
import { JobService } from '../job/job.service';
import { JobPriority } from '../job/job-priority.enum';
import { AssistantMemoryService } from '../assistant-memory/assistant-memory.service';
import { IndexedFileService } from '../indexed-file/indexed-file.service';
import { validateFolderScope, folderScopeReasonToMessage } from './folder-scope.validator';

export const DEFAULT_SYSTEM_PROMPT = [
  'You are the user\'s personal assistant in this workspace.',
  'To look up workspace content (notes, files, tasks, knowledge base, canvases) you MUST use the `search_workspace` tool — do NOT say "I don\'t have access", call the tool. Only after receiving results may you reply to the user.',
  'You have persistent memory about the user; lean on it when relevant.',
  'You are concise and clear, and respond in English by default. When asked to do something, do it or explain what you need to do it. Avoid filler.',
].join(' ');

@Injectable()
export class AssistantService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    @InjectRepository(AssistantEntity)
    private readonly assistantRepo: Repository<AssistantEntity>,
    @InjectRepository(AssistantMessageEntity)
    private readonly messageRepo: Repository<AssistantMessageEntity>,
    private readonly jobService: JobService,
    private readonly memoryService: AssistantMemoryService,
    @Inject(forwardRef(() => IndexedFileService))
    private readonly indexedFileService: IndexedFileService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const personal = await this.ensureDefault();
      this.logger.log(`Personal assistant ready (id=${personal.id})`);
    } catch (e: any) {
      this.logger.error(`Failed to seed personal assistant: ${e?.message ?? e}`);
    }
  }

  async ensureDefault(): Promise<AssistantEntity> {
    let personal = await this.assistantRepo.findOne({ where: { isSystem: true } });
    if (!personal) {
      personal = this.assistantRepo.create({
        name: 'Assistant',
        icon: '◇',
        isSystem: true,
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        sub: 'Your personal assistant',
      });
      personal = await this.assistantRepo.save(personal);
    }
    return personal;
  }

  async list(): Promise<AssistantEntity[]> {
    await this.ensureDefault();
    return this.assistantRepo.find({ order: { id: 'ASC' } });
  }

  async findOne(id: number): Promise<AssistantEntity> {
    const a = await this.assistantRepo.findOne({ where: { id } });
    if (!a) throw new NotFoundException(`Assistant ${id} not found`);
    return a;
  }

  async create(dto: CreateAssistantDto): Promise<AssistantEntity> {
    const folderScope = await this.resolveFolderScope(dto.folderScope);
    const created = this.assistantRepo.create({
      name: dto.name,
      systemPrompt: dto.systemPrompt ?? null,
      folderScope,
      icon: dto.icon ?? null,
      sub: dto.sub ?? null,
      pinned: dto.pinned ?? false,
      isSystem: false,
    });
    return this.assistantRepo.save(created);
  }

  async update(id: number, dto: UpdateAssistantDto): Promise<AssistantEntity> {
    const a = await this.findOne(id);
    const previousFolderScope = a.folderScope;
    if (dto.name !== undefined) a.name = dto.name;
    if (dto.systemPrompt !== undefined) a.systemPrompt = dto.systemPrompt;
    if (dto.folderScope !== undefined) a.folderScope = await this.resolveFolderScope(dto.folderScope);
    if (dto.icon !== undefined) a.icon = dto.icon;
    if (dto.sub !== undefined) a.sub = dto.sub;
    if (dto.pinned !== undefined) a.pinned = dto.pinned;
    const saved = await this.assistantRepo.save(a);
    if (dto.folderScope !== undefined && previousFolderScope !== saved.folderScope) {
      try {
        await this.indexedFileService.clearAllForOwner('main-assistant', saved.id);
      } catch (e: any) {
        this.logger.error(`Failed to clear indexed files for assistant ${saved.id}: ${e?.message ?? e}`);
      }
    }
    return saved;
  }

  private async resolveFolderScope(input: string | null | undefined): Promise<string | null> {
    if (input === undefined || input === null || input === '') return null;
    const result = await validateFolderScope(input);
    if (result.ok === true) return (result as { ok: true; absolutePath: string }).absolutePath;
    const reason = (result as { ok: false; reason: any }).reason;
    throw new BadRequestException(folderScopeReasonToMessage(reason));
  }

  async remove(id: number): Promise<void> {
    const a = await this.findOne(id);
    if (a.isSystem) {
      throw new ForbiddenException('The personal assistant cannot be deleted.');
    }
    await this.assistantRepo.remove(a);
  }

  async getMessages(assistantId: number): Promise<AssistantMessageEntity[]> {
    await this.findOne(assistantId);
    return this.messageRepo.find({
      where: { assistantId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  }

  async sendMessage(assistantId: number, content: string): Promise<{ userMessage: AssistantMessageEntity; jobId: number | null }> {
    const assistant = await this.findOne(assistantId);

    // Persist user message
    const userMsg = await this.messageRepo.save(
      this.messageRepo.create({
        assistantId,
        role: 'user',
        content,
      }),
    );

    // Touch lastSeenAt
    assistant.lastSeenAt = new Date();
    await this.assistantRepo.save(assistant);

    // Build conversation history for the worker
    const history = await this.messageRepo.find({
      where: { assistantId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    const conversation = history
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content }));

    // Retrieve recent memory entries to inject as context for the worker.
    // Only the system assistant has memory; for ayudantes this returns [].
    const memoryEntries = await this.memoryService.recentForInjection(assistantId, 25);
    const memorySnippets = memoryEntries.map((m) => ({
      id: m.id,
      name: m.name,
      type: m.type,
      body: m.body,
    }));

    // Memory extraction runs on every turn for the personal assistant — the
    // LLM itself decides if there's something worth saving (returns an empty
    // entry otherwise). This avoids language-specific heuristics like keyword
    // regexes that only catch one locale.
    const extractMemory = assistant.isSystem;

    // Create job for the worker
    const job = await this.jobService.create('assistant-chat', JobPriority.HIGH, {
      kind: 'assistant',
      ownerType: 'main-assistant',
      ownerId: assistantId,
      assistantId,
      assistantName: assistant.name,
      assistantSystem: assistant.isSystem,
      systemPrompt: assistant.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      folderScope: assistant.folderScope,
      conversation,
      memorySnippets,
      extractMemory,
    });

    return { userMessage: userMsg, jobId: job?.id ?? null };
  }

  async recordEvent(
    assistantId: number,
    content: string,
    event: Record<string, any>,
  ): Promise<AssistantMessageEntity> {
    return this.messageRepo.save(
      this.messageRepo.create({
        assistantId,
        role: 'event',
        content,
        event,
      }),
    );
  }

  async updateEventStatus(
    assistantId: number,
    messageId: number,
    status: 'done' | 'cancelled',
    summary?: string,
  ): Promise<AssistantMessageEntity> {
    const msg = await this.messageRepo.findOne({
      where: { id: messageId, assistantId },
    });
    if (!msg) throw new NotFoundException(`Event message ${messageId} not found`);
    if (msg.role !== 'event' || !msg.event) {
      throw new NotFoundException(`Message ${messageId} is not an event`);
    }
    const ev = msg.event as any;
    if (ev.kind === 'tool_executed' && ev.tool) {
      ev.tool.status = status;
      if (summary !== undefined) ev.tool.summary = summary;
    }
    msg.event = ev;
    return this.messageRepo.save(msg);
  }

  async recordAssistantReply(
    assistantId: number,
    reply: string,
    jobId: number | null,
    error: string | null = null,
  ): Promise<AssistantMessageEntity> {
    const msg = await this.messageRepo.save(
      this.messageRepo.create({
        assistantId,
        role: 'assistant',
        content: reply,
        jobId,
        error,
      }),
    );

    // Touch lastSeenAt of the assistant
    const a = await this.assistantRepo.findOne({ where: { id: assistantId } });
    if (a) {
      a.lastSeenAt = new Date();
      await this.assistantRepo.save(a);
    }

    return msg;
  }
}

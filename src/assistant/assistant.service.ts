import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Inject,
  forwardRef,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { AssistantEntity } from './assistant.entity';
import { AssistantMessageEntity } from './assistant-message.entity';
import { CreateAssistantDto, UpdateAssistantDto } from './dto/assistant.dto';
import { ExecutionService } from '../execution/execution.service';
import { IndexedFileService } from '../indexed-file/indexed-file.service';
import {
  validateFolderScope,
  folderScopeReasonToMessage,
} from './folder-scope.validator';
import { ExecutionAccessScope } from '../execution/execution.types';

export const MESSAGE_PAGE_SIZE = 50;
const MAX_MESSAGE_PAGE_SIZE = 200;

@Injectable()
export class AssistantService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    @InjectRepository(AssistantEntity)
    private readonly assistantRepo: Repository<AssistantEntity>,
    @InjectRepository(AssistantMessageEntity)
    private readonly messageRepo: Repository<AssistantMessageEntity>,
    @Inject(forwardRef(() => IndexedFileService))
    private readonly indexedFileService: IndexedFileService,
    private readonly executionService: ExecutionService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const personal = await this.ensureDefault();
      this.logger.log(`Personal assistant ready (id=${personal.id})`);
    } catch (e: any) {
      this.logger.error(
        `Failed to seed personal assistant: ${e?.message ?? e}`,
      );
    }
  }

  async ensureDefault(): Promise<AssistantEntity> {
    let personal = await this.assistantRepo.findOne({
      where: { isSystem: true },
    });
    if (!personal) {
      personal = this.assistantRepo.create({
        name: 'Assistant',
        icon: '◇',
        isSystem: true,
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
    if (dto.folderScope !== undefined)
      a.folderScope = await this.resolveFolderScope(dto.folderScope);
    if (dto.icon !== undefined) a.icon = dto.icon;
    if (dto.sub !== undefined) a.sub = dto.sub;
    if (dto.pinned !== undefined) a.pinned = dto.pinned;
    const saved = await this.assistantRepo.save(a);
    if (
      dto.folderScope !== undefined &&
      previousFolderScope !== saved.folderScope
    ) {
      try {
        await this.indexedFileService.clearAllForOwner({
          ownerType: 'main-assistant',
          ownerId: saved.id,
        });
      } catch (e: any) {
        this.logger.error(
          `Failed to clear indexed files for assistant ${saved.id}: ${e?.message ?? e}`,
        );
      }
    }
    return saved;
  }

  private async resolveFolderScope(
    input: string | null | undefined,
  ): Promise<string | null> {
    if (input === undefined || input === null || input === '') return null;
    const result = await validateFolderScope(input);
    if (result.ok === true)
      return (result as { ok: true; absolutePath: string }).absolutePath;
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

  async getMessages(
    assistantId: number,
    opts: { limit?: number; before?: number } = {},
  ): Promise<{ messages: AssistantMessageEntity[]; hasMore: boolean }> {
    await this.findOne(assistantId);
    const limit = Math.min(
      Math.max(opts.limit ?? MESSAGE_PAGE_SIZE, 1),
      MAX_MESSAGE_PAGE_SIZE,
    );
    const where: Record<string, any> = { assistantId };
    if (opts.before != null) where.id = LessThan(opts.before);
    // Keyset pagination by id (monotonic, append-only): fetch the newest
    // `limit + 1` rows to detect whether older history remains, then return
    // them in ascending order for the UI.
    const rows = await this.messageRepo.find({
      where,
      order: { id: 'DESC' },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    page.reverse();
    return { messages: page, hasMore };
  }

  async sendMessage(
    assistantId: number,
    content: string,
    accessScope: ExecutionAccessScope = {
      ownerPrincipal: 'standalone',
      workspaceId: 'default',
    },
  ): Promise<{
    userMessage: AssistantMessageEntity;
    executionId: string;
  }> {
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
    // Only ship a recent slice as transport — models decides the real context
    // window (history_turns). Never send the whole thread.
    const recent = await this.messageRepo.find({
      where: { assistantId },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: 40,
    });
    const conversation = recent
      .reverse()
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content }));

    const execution = await this.executionService.createForChat(
      'assistant_chat',
      content,
      accessScope,
      {
        kind: 'assistant',
        ownerType: 'main-assistant',
        ownerId: assistantId,
        name: assistant.name,
        assistantSystem: assistant.isSystem,
        folderScope: assistant.folderScope,
        conversation,
      },
    );

    return {
      userMessage: userMsg,
      executionId: execution.executionId,
    };
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
    if (!msg)
      throw new NotFoundException(`Event message ${messageId} not found`);
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
    executionId: string | null,
    error: string | null = null,
  ): Promise<AssistantMessageEntity> {
    const msg = await this.messageRepo.save(
      this.messageRepo.create({
        assistantId,
        role: 'assistant',
        content: reply,
        executionId,
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

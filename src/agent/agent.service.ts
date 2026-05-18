import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentEntity } from './agent.entity';
import { AgentMessageEntity } from './agent-message.entity';
import {
  CreateAgentDto,
  UpdateAgentDto,
} from './dto/agent.dto';
import { JobService } from '../job/job.service';
import { JobPriority } from '../job/job-priority.enum';
import { IndexedFileService } from '../indexed-file/indexed-file.service';
import {
  validateFolderScope,
  folderScopeReasonToMessage,
} from '../assistant/folder-scope.validator';
import {
  AGENT_DEFAULT_TTL_MS,
  AGENT_UNFAVORITE_GRACE_MS,
} from './agent.constants';

export const DEFAULT_AGENT_SYSTEM_PROMPT = [
  'You are an agent created by the user for a specific task.',
  'Your scope is strictly limited to the files inside your working folder, if one is configured.',
  'You do not have access to the user\'s workspace, notes, memory, or any other resource.',
  'If asked about anything beyond your folder, say you cannot see it and suggest the user redirect the request to their main assistant.',
].join(' ');

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    @InjectRepository(AgentEntity)
    private readonly agentRepo: Repository<AgentEntity>,
    @InjectRepository(AgentMessageEntity)
    private readonly messageRepo: Repository<AgentMessageEntity>,
    private readonly jobService: JobService,
    @Inject(forwardRef(() => IndexedFileService))
    private readonly indexedFileService: IndexedFileService,
  ) {}

  async findAll(): Promise<AgentEntity[]> {
    return this.agentRepo
      .createQueryBuilder('a')
      .orderBy('a.pinned', 'DESC')
      .addOrderBy('a.last_seen_at', 'DESC', 'NULLS LAST')
      .addOrderBy('a.id', 'DESC')
      .getMany();
  }

  async findOne(id: number): Promise<AgentEntity> {
    const a = await this.agentRepo.findOne({ where: { id } });
    if (!a) throw new NotFoundException(`Agent ${id} not found`);
    return a;
  }

  async create(dto: CreateAgentDto): Promise<AgentEntity> {
    const folderScope = await this.resolveFolderScope(dto.folderScope);
    const pinned = dto.pinned ?? false;
    const now = Date.now();
    const expiresAt = pinned ? null : new Date(now + AGENT_DEFAULT_TTL_MS);

    const created = this.agentRepo.create({
      name: dto.name,
      systemPrompt: dto.systemPrompt ?? null,
      folderScope,
      icon: dto.icon ?? null,
      sub: dto.sub ?? null,
      pinned,
      lastSeenAt: null,
      expiresAt,
    });
    return this.agentRepo.save(created);
  }

  async update(id: number, dto: UpdateAgentDto): Promise<AgentEntity> {
    const a = await this.findOne(id);
    const previousFolderScope = a.folderScope;
    const previousPinned = a.pinned;

    if (dto.name !== undefined) a.name = dto.name;
    if (dto.systemPrompt !== undefined) a.systemPrompt = dto.systemPrompt;
    if (dto.folderScope !== undefined)
      a.folderScope = await this.resolveFolderScope(dto.folderScope);
    if (dto.icon !== undefined) a.icon = dto.icon;
    if (dto.sub !== undefined) a.sub = dto.sub;

    if (dto.pinned !== undefined && dto.pinned !== previousPinned) {
      a.pinned = dto.pinned;
      if (dto.pinned === true) {
        a.expiresAt = null;
      } else {
        a.expiresAt = new Date(Date.now() + AGENT_UNFAVORITE_GRACE_MS);
      }
    }

    const saved = await this.agentRepo.save(a);

    if (
      dto.folderScope !== undefined
      && previousFolderScope !== saved.folderScope
    ) {
      try {
        await this.indexedFileService.clearAllForOwner('agent', saved.id);
      } catch (e: any) {
        this.logger.error(
          `Failed to clear indexed files for agent ${saved.id}: ${e?.message ?? e}`,
        );
      }
    }

    return saved;
  }

  async remove(id: number): Promise<void> {
    const a = await this.findOne(id);
    try {
      await this.indexedFileService.clearAllForOwner('agent', a.id);
    } catch (e: any) {
      this.logger.error(
        `Failed to clear indexed files while removing agent ${a.id}: ${e?.message ?? e}`,
      );
    }
    await this.agentRepo.remove(a);
  }

  async getMessages(agentId: number): Promise<AgentMessageEntity[]> {
    await this.findOne(agentId);
    return this.messageRepo.find({
      where: { agentId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  }

  async sendMessage(
    agentId: number,
    content: string,
  ): Promise<{ userMessage: AgentMessageEntity; jobId: number | null }> {
    const agent = await this.findOne(agentId);

    const userMsg = await this.messageRepo.save(
      this.messageRepo.create({
        agentId,
        role: 'user',
        content,
      }),
    );

    this.touchInteraction(agent);
    await this.agentRepo.save(agent);

    const history = await this.messageRepo.find({
      where: { agentId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    const conversation = history
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content }));

    const job = await this.jobService.create('assistant-chat', JobPriority.HIGH, {
      kind: 'agent',
      ownerType: 'agent',
      ownerId: agent.id,
      agentId: agent.id,
      assistantName: agent.name,
      systemPrompt: agent.systemPrompt ?? null,
      folderScope: agent.folderScope,
      conversation,
    });

    return { userMessage: userMsg, jobId: job?.id ?? null };
  }

  async recordEvent(
    agentId: number,
    content: string,
    event: Record<string, any>,
  ): Promise<AgentMessageEntity> {
    return this.messageRepo.save(
      this.messageRepo.create({
        agentId,
        role: 'event',
        content,
        event,
      }),
    );
  }

  async updateEventStatus(
    agentId: number,
    messageId: number,
    status: 'done' | 'cancelled',
    summary?: string,
  ): Promise<AgentMessageEntity> {
    const msg = await this.messageRepo.findOne({
      where: { id: messageId, agentId },
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

  async recordAgentReply(
    agentId: number,
    reply: string,
    jobId: number | null,
    error: string | null = null,
  ): Promise<AgentMessageEntity> {
    const msg = await this.messageRepo.save(
      this.messageRepo.create({
        agentId,
        role: 'assistant',
        content: reply,
        jobId,
        error,
      }),
    );

    const a = await this.agentRepo.findOne({ where: { id: agentId } });
    if (a) {
      this.touchInteraction(a);
      await this.agentRepo.save(a);
    }

    return msg;
  }

  private touchInteraction(agent: AgentEntity): void {
    agent.lastSeenAt = new Date();
    if (!agent.pinned) {
      agent.expiresAt = new Date(Date.now() + AGENT_DEFAULT_TTL_MS);
    } else {
      agent.expiresAt = null;
    }
  }

  private async resolveFolderScope(
    input: string | null | undefined,
  ): Promise<string | null> {
    if (input === undefined || input === null || input === '') return null;
    const result = await validateFolderScope(input);
    if (result.ok === true) {
      return (result as { ok: true; absolutePath: string }).absolutePath;
    }
    const reason = (result as { ok: false; reason: any }).reason;
    throw new BadRequestException(folderScopeReasonToMessage(reason));
  }
}

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
import { CreateAgentDto, UpdateAgentDto } from './dto/agent.dto';
import { ExecutionService } from '../execution/execution.service';
import { IndexedFileService } from '../indexed-file/indexed-file.service';
import {
  validateFolderScope,
  folderScopeReasonToMessage,
} from '../assistant/folder-scope.validator';
import {
  AGENT_DEFAULT_TTL_MS,
  AGENT_UNFAVORITE_GRACE_MS,
} from './agent.constants';
import { ExecutionAccessScope } from '../execution/execution.types';
import { ChatMessageStore } from '../common/chat-message.store';

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private readonly messages: ChatMessageStore<AgentMessageEntity>;

  constructor(
    @InjectRepository(AgentEntity)
    private readonly agentRepo: Repository<AgentEntity>,
    @InjectRepository(AgentMessageEntity)
    private readonly messageRepo: Repository<AgentMessageEntity>,
    @Inject(forwardRef(() => IndexedFileService))
    private readonly indexedFileService: IndexedFileService,
    private readonly executionService: ExecutionService,
  ) {
    this.messages = new ChatMessageStore<AgentMessageEntity>(messageRepo, {
      conflictLabel: 'agent',
      where: (agentId) => ({ agentId }),
      attach: (agentId, message) => ({ agentId, ...message }),
    });
  }

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
      dto.folderScope !== undefined &&
      previousFolderScope !== saved.folderScope
    ) {
      try {
        await this.indexedFileService.clearAllForOwner({
          ownerType: 'agent',
          ownerId: saved.id,
        });
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
      await this.indexedFileService.clearAllForOwner({
        ownerType: 'agent',
        ownerId: a.id,
      });
    } catch (e: any) {
      this.logger.error(
        `Failed to clear indexed files while removing agent ${a.id}: ${e?.message ?? e}`,
      );
    }
    await this.agentRepo.remove(a);
  }

  async getMessages(
    agentId: number,
    opts: { limit?: number; before?: number } = {},
  ): Promise<{ messages: AgentMessageEntity[]; hasMore: boolean }> {
    await this.findOne(agentId);
    return this.messages.page(agentId, opts);
  }

  async sendMessage(
    agentId: number,
    content: string,
    accessScope: ExecutionAccessScope = {
      ownerPrincipal: 'standalone',
    },
  ): Promise<{
    userMessage: AgentMessageEntity;
    executionId: string;
  }> {
    const agent = await this.findOne(agentId);

    const userMsg = await this.messages.appendUser(agentId, content);

    this.touchInteraction(agent);
    await this.agentRepo.save(agent);

    // Only ship a recent slice as transport — models decides the real context
    // window (history_turns). Never send the whole thread.
    const conversation = await this.messages.recentConversation(agentId);

    const execution = await this.executionService.createForChat(
      'agent_chat',
      content,
      accessScope,
      {
        ownerId: agent.id,
        systemPrompt: agent.systemPrompt ?? null,
        folderScope: agent.folderScope,
        conversation,
      },
    );

    return {
      userMessage: userMsg,
      executionId: execution.executionId,
    };
  }

  async recordAgentReply(
    agentId: number,
    reply: string,
    executionId: string | null,
    error: string | null = null,
  ): Promise<AgentMessageEntity> {
    return this.messages.recordReply(
      agentId,
      reply,
      executionId,
      error,
      async () => {
        const agent = await this.agentRepo.findOne({ where: { id: agentId } });
        if (agent) {
          this.touchInteraction(agent);
          await this.agentRepo.save(agent);
        }
      },
    );
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

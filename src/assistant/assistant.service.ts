import {
  Injectable,
  NotFoundException,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AssistantEntity } from './assistant.entity';
import { AssistantMessageEntity } from './assistant-message.entity';
import { ExecutionService } from '../execution/execution.service';
import { ExecutionAccessScope } from '../execution/execution.types';
import {
  ChatMessageStore,
  DEFAULT_CHAT_MESSAGE_PAGE_SIZE,
} from '../common/chat-message.store';

export const MESSAGE_PAGE_SIZE = DEFAULT_CHAT_MESSAGE_PAGE_SIZE;

@Injectable()
export class AssistantService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AssistantService.name);
  private readonly messages: ChatMessageStore<AssistantMessageEntity>;

  constructor(
    @InjectRepository(AssistantEntity)
    private readonly assistantRepo: Repository<AssistantEntity>,
    @InjectRepository(AssistantMessageEntity)
    private readonly messageRepo: Repository<AssistantMessageEntity>,
    private readonly executionService: ExecutionService,
  ) {
    this.messages = new ChatMessageStore<AssistantMessageEntity>(messageRepo, {
      conflictLabel: 'assistant',
      where: (assistantId) => ({ assistantId }),
      attach: (assistantId, message) => ({ assistantId, ...message }),
    });
  }

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
      where: { id: 1 },
    });
    if (!personal) {
      personal = this.assistantRepo.create({
        id: 1,
        name: 'Assistant',
        icon: '◇',
        sub: 'Your personal assistant',
      });
      personal = await this.assistantRepo.save(personal);
    }
    return personal;
  }

  async list(): Promise<AssistantEntity[]> {
    return [await this.ensureDefault()];
  }

  async findOne(id: number): Promise<AssistantEntity> {
    const a = await this.assistantRepo.findOne({ where: { id } });
    if (!a) throw new NotFoundException(`Assistant ${id} not found`);
    return a;
  }

  async getMessages(
    assistantId: number,
    opts: { limit?: number; before?: number } = {},
  ): Promise<{ messages: AssistantMessageEntity[]; hasMore: boolean }> {
    await this.findOne(assistantId);
    return this.messages.page(assistantId, opts);
  }

  async sendMessage(
    assistantId: number,
    content: string,
    accessScope: ExecutionAccessScope = {
      ownerPrincipal: 'standalone',
    },
  ): Promise<{
    userMessage: AssistantMessageEntity;
    executionId: string;
  }> {
    const assistant = await this.findOne(assistantId);

    const userMsg = await this.messages.appendUser(assistantId, content);

    // Touch lastSeenAt
    assistant.lastSeenAt = new Date();
    await this.assistantRepo.save(assistant);

    // Only ship a recent slice as transport — models decides the real context
    // window (history_turns). Never send the whole thread.
    const conversation = await this.messages.recentConversation(assistantId);

    const execution = await this.executionService.createForChat(
      'assistant_chat',
      content,
      accessScope,
      {
        ownerId: assistantId,
        conversation,
      },
    );

    return {
      userMessage: userMsg,
      executionId: execution.executionId,
    };
  }

  async recordAssistantReply(
    assistantId: number,
    reply: string,
    executionId: string | null,
    error: string | null = null,
  ): Promise<AssistantMessageEntity> {
    return this.messages.recordReply(
      assistantId,
      reply,
      executionId,
      error,
      async () => {
        const assistant = await this.assistantRepo.findOne({
          where: { id: assistantId },
        });
        if (assistant) {
          assistant.lastSeenAt = new Date();
          await this.assistantRepo.save(assistant);
        }
      },
    );
  }
}

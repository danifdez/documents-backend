import {
  BadRequestException,
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
import { ChatMessageStore } from '../common/chat-message.store';
import { IndexedFileService } from '../indexed-file/indexed-file.service';
import {
  folderScopeReasonToMessage,
  validateFolderScope,
} from './folder-scope.validator';

@Injectable()
export class AssistantService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AssistantService.name);
  private readonly messages: ChatMessageStore<AssistantMessageEntity>;

  constructor(
    @InjectRepository(AssistantEntity)
    private readonly assistantRepo: Repository<AssistantEntity>,
    @InjectRepository(AssistantMessageEntity)
    messageRepo: Repository<AssistantMessageEntity>,
    private readonly indexedFileService: IndexedFileService,
    private readonly executionService: ExecutionService,
  ) {
    this.messages = new ChatMessageStore<AssistantMessageEntity>(messageRepo, {
      where: (assistantId) => ({ assistantId }),
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    // In server mode assistants are created lazily for each authenticated
    // principal. Only standalone mode needs a global default row.
    if (process.env.AUTH_ENABLED === 'true') return;

    try {
      const personal = await this.ensureDefault('standalone');
      this.logger.log(`Personal assistant ready (id=${personal.id})`);
    } catch (e: any) {
      this.logger.error(
        `Failed to seed personal assistant: ${e?.message ?? e}`,
      );
    }
  }

  async ensureDefault(ownerPrincipal: string): Promise<AssistantEntity> {
    let personal = await this.assistantRepo.findOne({
      where: { ownerPrincipal },
      order: { id: 'ASC' },
    });
    if (!personal) {
      personal = this.assistantRepo.create({
        name: 'Assistant',
        icon: '◇',
        sub: 'Your personal assistant',
        ownerPrincipal,
      });
      try {
        personal = await this.assistantRepo.save(personal);
      } catch (error) {
        // The unique owner index makes concurrent first requests safe: the
        // loser re-reads the row created by the winner.
        if ((error as { code?: string }).code === '23505') {
          personal = await this.assistantRepo.findOne({
            where: { ownerPrincipal },
            order: { id: 'ASC' },
          });
          if (personal) return personal;
        }
        throw error;
      }
    }
    return personal;
  }

  async list(ownerPrincipal: string): Promise<AssistantEntity[]> {
    return [await this.ensureDefault(ownerPrincipal)];
  }

  async findOne(id: number, ownerPrincipal: string): Promise<AssistantEntity> {
    const a = await this.assistantRepo.findOne({
      where: { id, ownerPrincipal },
    });
    if (!a) throw new NotFoundException(`Assistant ${id} not found`);
    return a;
  }

  async updateWorkingFolder(
    id: number,
    folderScope: string | null,
    ownerPrincipal: string,
  ): Promise<AssistantEntity> {
    const assistant = await this.findOne(id, ownerPrincipal);
    const nextScope = await this.resolveFolderScope(folderScope);
    if (assistant.folderScope === nextScope) return assistant;
    assistant.folderScope = nextScope;
    const saved = await this.assistantRepo.save(assistant);
    await this.indexedFileService.clearAllForOwner({
      ownerType: 'assistant',
      ownerId: assistant.id,
    });
    return saved;
  }

  async getMessages(
    assistantId: number,
    ownerPrincipal: string,
    opts: { limit?: number; before?: number } = {},
  ): Promise<{ messages: AssistantMessageEntity[]; hasMore: boolean }> {
    await this.findOne(assistantId, ownerPrincipal);
    return this.messages.page(assistantId, opts);
  }

  async sendMessage(
    assistantId: number,
    content: string,
    accessScope: ExecutionAccessScope = {
      ownerPrincipal: 'standalone',
    },
    requestId?: string,
  ): Promise<{
    userMessage: AssistantMessageEntity;
    executionId: string;
  }> {
    const assistant = await this.findOne(
      assistantId,
      accessScope.ownerPrincipal,
    );

    // Touch lastSeenAt
    assistant.lastSeenAt = new Date();
    await this.assistantRepo.save(assistant);

    const { execution, userMessage } =
      await this.executionService.createForChat(
        'assistant_chat',
        content,
        accessScope,
        {
          ownerId: assistantId,
          folderScope: assistant.folderScope,
        },
        requestId,
      );

    return {
      userMessage: userMessage as AssistantMessageEntity,
      executionId: execution.executionId,
    };
  }

  async readMessageRequest(
    assistantId: number,
    requestId: string,
    ownerPrincipal: string,
  ) {
    await this.findOne(assistantId, ownerPrincipal);
    const accepted = await this.executionService.readChatRequest(
      requestId,
      { ownerPrincipal },
      assistantId,
    );
    return {
      userMessage: accepted.userMessage,
      executionId: accepted.execution.executionId,
    };
  }

  private async resolveFolderScope(
    input: string | null,
  ): Promise<string | null> {
    if (input === null || input.trim() === '') return null;
    const result = await validateFolderScope(input);
    if (result.ok === true) return result.absolutePath;
    throw new BadRequestException(folderScopeReasonToMessage(result.reason));
  }
}

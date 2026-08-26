import { ConflictException } from '@nestjs/common';
import {
  DeepPartial,
  FindOptionsOrder,
  FindOptionsWhere,
  LessThan,
  ObjectLiteral,
  Repository,
} from 'typeorm';

export const DEFAULT_CHAT_MESSAGE_PAGE_SIZE = 50;
const MAX_CHAT_MESSAGE_PAGE_SIZE = 200;
const CHAT_CONTEXT_MESSAGE_LIMIT = 40;

type ChatMessageRole = 'user' | 'assistant' | 'system' | 'event';

export interface ChatMessageRecord extends ObjectLiteral {
  id: number;
  role: ChatMessageRole;
  content: string;
  executionId: string | null;
  error: string | null;
  event: Record<string, any> | null;
  createdAt: Date;
}

type ChatMessageInput = {
  role: ChatMessageRole;
  content: string;
  executionId?: string | null;
  error?: string | null;
  event?: Record<string, any> | null;
};

export interface ChatMessageOwner<T extends ChatMessageRecord> {
  conflictLabel: string;
  where(ownerId: number): FindOptionsWhere<T>;
  attach(ownerId: number, message: ChatMessageInput): DeepPartial<T>;
}

export type MessagePageOptions = {
  limit?: number;
  before?: number;
};

export type MessagePage<T> = {
  messages: T[];
  hasMore: boolean;
};

export type ConversationTurn = {
  role: 'user' | 'assistant';
  content: string;
};

export class ChatMessageStore<T extends ChatMessageRecord> {
  constructor(
    private readonly repository: Repository<T>,
    private readonly owner: ChatMessageOwner<T>,
  ) {}

  async page(
    ownerId: number,
    options: MessagePageOptions = {},
  ): Promise<MessagePage<T>> {
    const limit = Math.min(
      Math.max(options.limit ?? DEFAULT_CHAT_MESSAGE_PAGE_SIZE, 1),
      MAX_CHAT_MESSAGE_PAGE_SIZE,
    );
    const where = {
      ...this.owner.where(ownerId),
      ...(options.before != null ? { id: LessThan(options.before) } : {}),
    } as FindOptionsWhere<T>;
    const rows = await this.repository.find({
      where,
      order: { id: 'DESC' } as FindOptionsOrder<T>,
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const messages = hasMore ? rows.slice(0, limit) : rows;
    messages.reverse();
    return { messages, hasMore };
  }

  async appendUser(ownerId: number, content: string): Promise<T> {
    return this.save(ownerId, { role: 'user', content });
  }

  async recentConversation(ownerId: number): Promise<ConversationTurn[]> {
    const rows = await this.repository.find({
      where: this.owner.where(ownerId),
      order: { createdAt: 'DESC', id: 'DESC' } as FindOptionsOrder<T>,
      take: CHAT_CONTEXT_MESSAGE_LIMIT,
    });
    return rows
      .reverse()
      .filter(
        (message): message is T & { role: 'user' | 'assistant' } =>
          message.role === 'user' || message.role === 'assistant',
      )
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));
  }

  async recordReply(
    ownerId: number,
    reply: string,
    executionId: string | null,
    error: string | null = null,
    afterCreate?: (message: T) => Promise<void>,
  ): Promise<T> {
    const findExisting = () =>
      executionId
        ? this.repository.findOne({
            where: {
              ...this.owner.where(ownerId),
              executionId,
              role: 'assistant',
            } as FindOptionsWhere<T>,
          })
        : Promise.resolve(null);
    const returnExisting = (existing: T | null) => {
      if (!existing) return null;
      if (existing.content !== reply || existing.error !== error) {
        throw new ConflictException(
          `Execution ${executionId} already has a different ${this.owner.conflictLabel} reply`,
        );
      }
      return existing;
    };
    const existing = returnExisting(await findExisting());
    if (existing) return existing;

    let message: T;
    try {
      message = await this.save(ownerId, {
        role: 'assistant',
        content: reply,
        executionId,
        error,
      });
    } catch (saveError) {
      const raced = returnExisting(await findExisting());
      if (raced) return raced;
      throw saveError;
    }

    await afterCreate?.(message);
    return message;
  }

  private async save(ownerId: number, input: ChatMessageInput): Promise<T> {
    const message = this.repository.create(this.owner.attach(ownerId, input));
    return this.repository.save(message);
  }
}

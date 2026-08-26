import {
  FindOptionsOrder,
  FindOptionsWhere,
  LessThan,
  ObjectLiteral,
  Repository,
} from 'typeorm';

export const DEFAULT_CHAT_MESSAGE_PAGE_SIZE = 50;
const MAX_CHAT_MESSAGE_PAGE_SIZE = 200;

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

export interface ChatMessageOwner<T extends ChatMessageRecord> {
  where(ownerId: number): FindOptionsWhere<T>;
}

export type MessagePageOptions = {
  limit?: number;
  before?: number;
};

export type MessagePage<T> = {
  messages: T[];
  hasMore: boolean;
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
}

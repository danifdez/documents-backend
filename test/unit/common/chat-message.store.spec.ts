import { ConflictException } from '@nestjs/common';
import { Repository } from 'typeorm';
import {
  ChatMessageRecord,
  ChatMessageStore,
} from '../../../src/common/chat-message.store';

type TestMessage = ChatMessageRecord & { ownerId: number };

const EXECUTION_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca701';

function message(
  overrides: Partial<TestMessage> & Pick<TestMessage, 'id' | 'ownerId'>,
): TestMessage {
  return {
    role: 'user',
    content: '',
    executionId: null,
    error: null,
    event: null,
    createdAt: new Date(0),
    ...overrides,
  };
}

function createStore(repository: Repository<TestMessage>) {
  return new ChatMessageStore(repository, {
    conflictLabel: 'test owner',
    where: (ownerId) => ({ ownerId }),
    attach: (ownerId, input) => ({ ownerId, ...input }),
  });
}

describe('ChatMessageStore', () => {
  it('builds recent conversation in chronological order and omits events', async () => {
    const repository = {
      find: jest.fn(async () => [
        message({ id: 3, ownerId: 7, role: 'event', content: 'tool' }),
        message({ id: 2, ownerId: 7, role: 'assistant', content: 'reply' }),
        message({ id: 1, ownerId: 7, role: 'user', content: 'question' }),
      ]),
    } as unknown as Repository<TestMessage>;
    const store = createStore(repository);

    await expect(store.recentConversation(7)).resolves.toEqual([
      { role: 'user', content: 'question' },
      { role: 'assistant', content: 'reply' },
    ]);
    expect(repository.find).toHaveBeenCalledWith({
      where: { ownerId: 7 },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: 40,
    });
  });

  it('reuses an identical reply without running the creation callback', async () => {
    const existing = message({
      id: 4,
      ownerId: 7,
      role: 'assistant',
      content: 'reply',
      executionId: EXECUTION_ID,
    });
    const repository = {
      findOne: jest.fn(async () => existing),
    } as unknown as Repository<TestMessage>;
    const store = createStore(repository);
    const afterCreate = jest.fn(async () => undefined);

    await expect(
      store.recordReply(7, 'reply', EXECUTION_ID, null, afterCreate),
    ).resolves.toBe(existing);
    expect(afterCreate).not.toHaveBeenCalled();
  });

  it('rejects a different reply for the same execution', async () => {
    const existing = message({
      id: 4,
      ownerId: 7,
      role: 'assistant',
      content: 'first',
      executionId: EXECUTION_ID,
    });
    const repository = {
      findOne: jest.fn(async () => existing),
    } as unknown as Repository<TestMessage>;
    const store = createStore(repository);

    await expect(store.recordReply(7, 'second', EXECUTION_ID)).rejects.toThrow(
      new ConflictException(
        `Execution ${EXECUTION_ID} already has a different test owner reply`,
      ),
    );
  });

  it('recovers the reply inserted by a concurrent writer', async () => {
    const raced = message({
      id: 4,
      ownerId: 7,
      role: 'assistant',
      content: 'reply',
      executionId: EXECUTION_ID,
    });
    const repository = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(raced),
      create: jest.fn((input) => input),
      save: jest.fn().mockRejectedValue(new Error('unique constraint')),
    } as unknown as Repository<TestMessage>;
    const store = createStore(repository);
    const afterCreate = jest.fn(async () => undefined);

    await expect(
      store.recordReply(7, 'reply', EXECUTION_ID, null, afterCreate),
    ).resolves.toBe(raced);
    expect(afterCreate).not.toHaveBeenCalled();
  });
});

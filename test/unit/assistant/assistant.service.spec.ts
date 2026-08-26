import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException } from '@nestjs/common';
import { AssistantService } from '../../../src/assistant/assistant.service';
import { AssistantEntity } from '../../../src/assistant/assistant.entity';
import { AssistantMessageEntity } from '../../../src/assistant/assistant-message.entity';
import { ExecutionService } from '../../../src/execution/execution.service';
import { IndexedFileService } from '../../../src/indexed-file/indexed-file.service';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

const EXECUTION_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca701';

function createMockRepo() {
  const store = new Map<number, any>();
  let nextId = 1;
  return {
    store,
    findOne: jest.fn(async ({ where }: any) => {
      for (const row of store.values()) {
        const match = Object.entries(where).every(([k, v]) => row[k] === v);
        if (match) return row;
      }
      return null;
    }),
    find: jest.fn(async () => [...store.values()]),
    create: jest.fn((data: any) => ({ ...data })),
    save: jest.fn(async (data: any) => {
      if (data.id == null) data.id = nextId++;
      store.set(data.id, data);
      return data;
    }),
    remove: jest.fn(async (entity: any) => {
      if (entity?.id != null) store.delete(entity.id);
      return entity;
    }),
  };
}

describe('AssistantService — personal assistant', () => {
  let service: AssistantService;
  let assistantRepo: ReturnType<typeof createMockRepo>;
  let messageRepo: ReturnType<typeof createMockRepo>;
  let indexedFiles: { clearAllForOwner: jest.Mock };

  beforeEach(async () => {
    assistantRepo = createMockRepo();
    messageRepo = createMockRepo();
    indexedFiles = { clearAllForOwner: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssistantService,
        {
          provide: getRepositoryToken(AssistantEntity),
          useValue: assistantRepo,
        },
        {
          provide: getRepositoryToken(AssistantMessageEntity),
          useValue: messageRepo,
        },
        {
          provide: IndexedFileService,
          useValue: indexedFiles,
        },
        {
          provide: ExecutionService,
          useValue: {
            createForChat: jest.fn(async () => ({
              executionId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
            })),
          },
        },
      ],
    }).compile();
    service = module.get(AssistantService);
  });

  it('creates and returns the fixed singleton when the table is empty', async () => {
    const result = await service.list();

    expect(result).toEqual([
      expect.objectContaining({ id: 1, name: 'Assistant' }),
    ]);
    expect(assistantRepo.store.size).toBe(1);
  });

  it('reuses the exact assistant reply when an execution is replayed', async () => {
    assistantRepo.store.set(1, { id: 1, name: 'Assistant' });

    const first = await service.recordAssistantReply(1, 'reply', EXECUTION_ID);
    const replay = await service.recordAssistantReply(1, 'reply', EXECUTION_ID);

    expect(replay).toBe(first);
    expect(messageRepo.store.size).toBe(1);
  });

  it('rejects a different assistant reply for the same execution', async () => {
    assistantRepo.store.set(1, { id: 1, name: 'Assistant' });
    await service.recordAssistantReply(1, 'reply', EXECUTION_ID);

    await expect(
      service.recordAssistantReply(1, 'different', EXECUTION_ID),
    ).rejects.toThrow(ConflictException);
  });

  it('configures a working folder on the singleton and clears stale indexed rows', async () => {
    const scope = await fs.mkdtemp(path.join(os.tmpdir(), 'assistant-scope-'));
    try {
      assistantRepo.store.set(1, {
        id: 1,
        name: 'Assistant',
        folderScope: null,
      });

      const assistant = await service.updateWorkingFolder(1, scope);

      expect(assistant.folderScope).toBe(scope);
      expect(indexedFiles.clearAllForOwner).toHaveBeenCalledWith({
        ownerType: 'assistant',
        ownerId: 1,
      });
    } finally {
      await fs.rm(scope, { recursive: true, force: true });
    }
  });
});
// A message repo whose `find` honours where.assistantId, the LessThan(id)
// cursor, `order.id` and `take` — enough to exercise keyset pagination.
function createPagingMessageRepo(
  rows: Array<{ id: number; assistantId: number }>,
) {
  return {
    find: jest.fn(async ({ where, order, take }: any) => {
      let out = rows.filter((r) => r.assistantId === where.assistantId);
      if (where.id) out = out.filter((r) => r.id < where.id.value);
      out = [...out].sort((a, b) =>
        order?.id === 'DESC' ? b.id - a.id : a.id - b.id,
      );
      return take != null ? out.slice(0, take) : out;
    }),
  };
}

describe('AssistantService — getMessages() pagination', () => {
  async function build(rows: Array<{ id: number; assistantId: number }>) {
    const assistantRepo = createMockRepo();
    assistantRepo.store.set(1, { id: 1, name: 'Assistant' });
    const messageRepo = createPagingMessageRepo(rows);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssistantService,
        {
          provide: getRepositoryToken(AssistantEntity),
          useValue: assistantRepo,
        },
        {
          provide: getRepositoryToken(AssistantMessageEntity),
          useValue: messageRepo,
        },
        {
          provide: IndexedFileService,
          useValue: { clearAllForOwner: jest.fn() },
        },
        {
          provide: ExecutionService,
          useValue: {
            createForChat: jest.fn(async () => ({
              executionId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
            })),
          },
        },
      ],
    }).compile();
    return {
      service: module.get(AssistantService) as AssistantService,
      messageRepo,
    };
  }

  const seed = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: i + 1, assistantId: 1 }));

  it('returns the newest page in ascending order with hasMore=true when more remain', async () => {
    const { service, messageRepo } = await build(seed(60));
    const { messages, hasMore } = await service.getMessages(1, { limit: 50 });
    expect(messageRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ order: { id: 'DESC' }, take: 51 }),
    );
    expect(messages.map((m) => m.id)).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 11),
    );
    expect(hasMore).toBe(true);
  });

  it('returns hasMore=false when the page is not full', async () => {
    const { service } = await build(seed(30));
    const { messages, hasMore } = await service.getMessages(1, { limit: 50 });
    expect(messages).toHaveLength(30);
    expect(hasMore).toBe(false);
  });

  it('uses the before cursor (LessThan) to page backwards', async () => {
    const { service, messageRepo } = await build(seed(60));
    const { messages, hasMore } = await service.getMessages(1, {
      limit: 50,
      before: 11,
    });
    const whereArg = messageRepo.find.mock.calls[0][0].where;
    expect(whereArg.id).toBeDefined();
    expect(messages.map((m) => m.id)).toEqual(
      Array.from({ length: 10 }, (_, i) => i + 1),
    );
    expect(hasMore).toBe(false);
  });
});

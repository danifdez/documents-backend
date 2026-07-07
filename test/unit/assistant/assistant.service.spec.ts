import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException } from '@nestjs/common';
import { AssistantService } from '../../../src/assistant/assistant.service';
import { AssistantEntity } from '../../../src/assistant/assistant.entity';
import { AssistantMessageEntity } from '../../../src/assistant/assistant-message.entity';
import { JobService } from '../../../src/job/job.service';
import { AssistantMemoryService } from '../../../src/assistant-memory/assistant-memory.service';
import { IndexedFileService } from '../../../src/indexed-file/indexed-file.service';

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

describe('AssistantService — remove() protection', () => {
    let service: AssistantService;
    let assistantRepo: ReturnType<typeof createMockRepo>;
    let messageRepo: ReturnType<typeof createMockRepo>;

    beforeEach(async () => {
        assistantRepo = createMockRepo();
        messageRepo = createMockRepo();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AssistantService,
                { provide: getRepositoryToken(AssistantEntity), useValue: assistantRepo },
                { provide: getRepositoryToken(AssistantMessageEntity), useValue: messageRepo },
                { provide: JobService, useValue: { create: jest.fn() } },
                { provide: AssistantMemoryService, useValue: { recentForInjection: jest.fn(async () => []) } },
                { provide: IndexedFileService, useValue: { clearAllForOwner: jest.fn() } },
            ],
        }).compile();
        service = module.get(AssistantService);
    });

    it('throws ForbiddenException when removing the personal assistant (isSystem=true)', async () => {
        assistantRepo.store.set(1, { id: 1, name: 'Assistant', isSystem: true });
        await expect(service.remove(1)).rejects.toThrow(ForbiddenException);
        expect(assistantRepo.store.size).toBe(1);
    });

    it('does not protect a non-system assistant (legacy path kept for future use)', async () => {
        assistantRepo.store.set(2, { id: 2, name: 'Other', isSystem: false });
        await service.remove(2);
        expect(assistantRepo.store.size).toBe(0);
    });
});

// A message repo whose `find` honours where.assistantId, the LessThan(id)
// cursor, `order.id` and `take` — enough to exercise keyset pagination.
function createPagingMessageRepo(rows: Array<{ id: number; assistantId: number }>) {
    return {
        find: jest.fn(async ({ where, order, take }: any) => {
            let out = rows.filter((r) => r.assistantId === where.assistantId);
            if (where.id) out = out.filter((r) => r.id < where.id.value);
            out = [...out].sort((a, b) => (order?.id === 'DESC' ? b.id - a.id : a.id - b.id));
            return take != null ? out.slice(0, take) : out;
        }),
    };
}

describe('AssistantService — getMessages() pagination', () => {
    async function build(rows: Array<{ id: number; assistantId: number }>) {
        const assistantRepo = createMockRepo();
        assistantRepo.store.set(1, { id: 1, name: 'Assistant', isSystem: true });
        const messageRepo = createPagingMessageRepo(rows);
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AssistantService,
                { provide: getRepositoryToken(AssistantEntity), useValue: assistantRepo },
                { provide: getRepositoryToken(AssistantMessageEntity), useValue: messageRepo },
                { provide: JobService, useValue: { create: jest.fn() } },
                { provide: AssistantMemoryService, useValue: {} },
                { provide: IndexedFileService, useValue: {} },
            ],
        }).compile();
        return { service: module.get(AssistantService) as AssistantService, messageRepo };
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
        const { messages, hasMore } = await service.getMessages(1, { limit: 50, before: 11 });
        const whereArg = messageRepo.find.mock.calls[0][0].where;
        expect(whereArg.id).toBeDefined();
        expect(messages.map((m) => m.id)).toEqual(
            Array.from({ length: 10 }, (_, i) => i + 1),
        );
        expect(hasMore).toBe(false);
    });
});

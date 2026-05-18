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

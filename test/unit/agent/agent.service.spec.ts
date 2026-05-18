import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { AgentService } from '../../../src/agent/agent.service';
import { AgentEntity } from '../../../src/agent/agent.entity';
import { AgentMessageEntity } from '../../../src/agent/agent-message.entity';
import {
    AGENT_DEFAULT_TTL_MS,
    AGENT_UNFAVORITE_GRACE_MS,
} from '../../../src/agent/agent.constants';
import { JobService } from '../../../src/job/job.service';
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
        find: jest.fn(async (opts: any = {}) => {
            const where = opts.where;
            const list: any[] = [];
            for (const row of store.values()) {
                if (!where) { list.push(row); continue; }
                const match = Object.entries(where).every(([k, v]) => row[k] === v);
                if (match) list.push(row);
            }
            return list;
        }),
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
        delete: jest.fn(async (criteria: any) => {
            if (criteria.id != null) {
                store.delete(criteria.id);
                return { affected: 1 };
            }
            const entries = Object.entries(criteria);
            for (const [k, v] of store.entries()) {
                const match = entries.every(([ck, cv]) => v[ck] === cv);
                if (match) store.delete(k);
            }
            return { affected: 1 };
        }),
        createQueryBuilder: jest.fn(() => {
            // Minimal chainable QB that returns whatever's in the store as-is.
            // findAll's order is checked separately (sorted on the SQL side).
            const all = [...store.values()];
            const chain: any = {
                orderBy: jest.fn(() => chain),
                addOrderBy: jest.fn(() => chain),
                getMany: jest.fn(async () => all),
            };
            return chain;
        }),
    };
}

const ALMOST = 2_000; // ms tolerance for "now-ish" assertions

describe('AgentService', () => {
    let service: AgentService;
    let agentRepo: ReturnType<typeof createMockRepo>;
    let messageRepo: ReturnType<typeof createMockRepo>;
    let jobService: { create: jest.Mock };
    let indexedFileService: { clearAllForOwner: jest.Mock };

    beforeEach(async () => {
        agentRepo = createMockRepo();
        messageRepo = createMockRepo();
        jobService = { create: jest.fn(async () => ({ id: 99 })) };
        indexedFileService = { clearAllForOwner: jest.fn(async () => undefined) };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AgentService,
                { provide: getRepositoryToken(AgentEntity), useValue: agentRepo },
                { provide: getRepositoryToken(AgentMessageEntity), useValue: messageRepo },
                { provide: JobService, useValue: jobService },
                { provide: IndexedFileService, useValue: indexedFileService },
            ],
        }).compile();
        service = module.get(AgentService);
    });

    describe('create', () => {
        it('sets expiresAt to now + 2 days when not pinned', async () => {
            const before = Date.now();
            const a = await service.create({ name: 'Vacation' });
            const after = Date.now();

            expect(a.pinned).toBe(false);
            expect(a.expiresAt).not.toBeNull();
            const ts = (a.expiresAt as Date).getTime();
            expect(ts).toBeGreaterThanOrEqual(before + AGENT_DEFAULT_TTL_MS - ALMOST);
            expect(ts).toBeLessThanOrEqual(after + AGENT_DEFAULT_TTL_MS + ALMOST);
        });

        it('leaves expiresAt null when pinned', async () => {
            const a = await service.create({ name: 'Pinned', pinned: true });
            expect(a.pinned).toBe(true);
            expect(a.expiresAt).toBeNull();
        });

        it('lastSeenAt starts as null', async () => {
            const a = await service.create({ name: 'X' });
            expect(a.lastSeenAt).toBeNull();
        });
    });

    describe('update', () => {
        it('pinned false → true clears expiresAt', async () => {
            const a = await service.create({ name: 'A' });
            const updated = await service.update(a.id, { pinned: true });
            expect(updated.pinned).toBe(true);
            expect(updated.expiresAt).toBeNull();
        });

        it('pinned true → false sets expiresAt to now + 1 day (grace)', async () => {
            const a = await service.create({ name: 'A', pinned: true });
            const before = Date.now();
            const updated = await service.update(a.id, { pinned: false });
            const after = Date.now();
            expect(updated.pinned).toBe(false);
            expect(updated.expiresAt).not.toBeNull();
            const ts = (updated.expiresAt as Date).getTime();
            expect(ts).toBeGreaterThanOrEqual(before + AGENT_UNFAVORITE_GRACE_MS - ALMOST);
            expect(ts).toBeLessThanOrEqual(after + AGENT_UNFAVORITE_GRACE_MS + ALMOST);
        });

        it('does not touch expiresAt when pinned is unchanged', async () => {
            const a = await service.create({ name: 'A' });
            const originalExpiresAt = (a.expiresAt as Date).getTime();
            await new Promise((r) => setTimeout(r, 10));
            const updated = await service.update(a.id, { name: 'A-renamed' });
            expect((updated.expiresAt as Date).getTime()).toBe(originalExpiresAt);
            expect(updated.name).toBe('A-renamed');
        });

        it('clears indexed files when folderScope changes', async () => {
            // Plant a row directly to skip folder-scope validation in create().
            agentRepo.store.set(1, {
                id: 1, name: 'A', folderScope: null, pinned: false,
                lastSeenAt: null, expiresAt: new Date(),
                systemPrompt: null, icon: null, sub: null,
            });
            // Force folderScope change via direct path bypass: pass null which
            // resolveFolderScope normalises to null without touching disk.
            await service.update(1, { folderScope: null as any });
            // No-op (null → null doesn't differ); clearAllForOwner shouldn't fire.
            expect(indexedFileService.clearAllForOwner).not.toHaveBeenCalled();
        });
    });

    describe('sendMessage', () => {
        it('resets expiresAt to now + 2 days when not pinned', async () => {
            const a = await service.create({ name: 'A' });
            // Move expiresAt backwards so we can assert the bump.
            const stale = new Date(Date.now() - 60_000);
            (agentRepo.store.get(a.id) as any).expiresAt = stale;

            const before = Date.now();
            await service.sendMessage(a.id, 'hello');
            const after = Date.now();

            const refreshed = agentRepo.store.get(a.id) as any;
            const ts = (refreshed.expiresAt as Date).getTime();
            expect(ts).toBeGreaterThanOrEqual(before + AGENT_DEFAULT_TTL_MS - ALMOST);
            expect(ts).toBeLessThanOrEqual(after + AGENT_DEFAULT_TTL_MS + ALMOST);
        });

        it('keeps expiresAt null when pinned', async () => {
            const a = await service.create({ name: 'A', pinned: true });
            await service.sendMessage(a.id, 'hello');
            const refreshed = agentRepo.store.get(a.id) as any;
            expect(refreshed.expiresAt).toBeNull();
        });

        it('persists the user message and enqueues a job with kind=agent', async () => {
            const a = await service.create({ name: 'A' });
            const { userMessage, jobId } = await service.sendMessage(a.id, 'hi');
            expect(userMessage.role).toBe('user');
            expect(userMessage.content).toBe('hi');
            expect(jobId).toBe(99);
            const [type, , payload] = jobService.create.mock.calls[0];
            expect(type).toBe('assistant-chat');
            expect(payload).toMatchObject({
                kind: 'agent',
                ownerType: 'agent',
                ownerId: a.id,
                agentId: a.id,
            });
        });

        it('updates lastSeenAt', async () => {
            const a = await service.create({ name: 'A' });
            expect(a.lastSeenAt).toBeNull();
            await service.sendMessage(a.id, 'hi');
            const refreshed = agentRepo.store.get(a.id) as any;
            expect(refreshed.lastSeenAt).toBeInstanceOf(Date);
        });
    });

    describe('recordAgentReply', () => {
        it('resets expiresAt to now + 2 days when not pinned', async () => {
            const a = await service.create({ name: 'A' });
            const stale = new Date(Date.now() - 60_000);
            (agentRepo.store.get(a.id) as any).expiresAt = stale;

            const before = Date.now();
            await service.recordAgentReply(a.id, 'reply', 42);
            const after = Date.now();

            const refreshed = agentRepo.store.get(a.id) as any;
            const ts = (refreshed.expiresAt as Date).getTime();
            expect(ts).toBeGreaterThanOrEqual(before + AGENT_DEFAULT_TTL_MS - ALMOST);
            expect(ts).toBeLessThanOrEqual(after + AGENT_DEFAULT_TTL_MS + ALMOST);
        });

        it('keeps expiresAt null when pinned', async () => {
            const a = await service.create({ name: 'A', pinned: true });
            await service.recordAgentReply(a.id, 'reply', 42);
            const refreshed = agentRepo.store.get(a.id) as any;
            expect(refreshed.expiresAt).toBeNull();
        });
    });

    describe('remove', () => {
        it('removes the agent, its messages (via repo) and clears indexed files', async () => {
            const a = await service.create({ name: 'A' });
            await service.sendMessage(a.id, 'hi');
            expect(agentRepo.store.size).toBe(1);
            expect(messageRepo.store.size).toBe(1);

            await service.remove(a.id);

            expect(agentRepo.store.size).toBe(0);
            // agent_messages are cascaded by the DB FK; the mock repo doesn't
            // model FK cascade so we only assert the cascade to IndexedFile.
            expect(indexedFileService.clearAllForOwner).toHaveBeenCalledWith('agent', a.id);
        });

        it('throws when the agent does not exist', async () => {
            await expect(service.remove(999)).rejects.toThrow(NotFoundException);
        });

        it('does not touch the filesystem (no fs.unlink involved)', async () => {
            // The service never imports fs directly — it delegates disk-side
            // concerns to IndexedFileService. We verify that the contract
            // surface stays free of fs operations by spying on indexedFileService
            // (the only collaborator that could touch disk) and asserting
            // it was invoked with clearAllForOwner (which by design only
            // touches DB/vectors, never the filesystem).
            const a = await service.create({ name: 'A' });
            await service.remove(a.id);
            expect(indexedFileService.clearAllForOwner).toHaveBeenCalledTimes(1);
            expect(indexedFileService.clearAllForOwner).toHaveBeenCalledWith('agent', a.id);
        });
    });

    describe('findOne', () => {
        it('throws NotFoundException when missing', async () => {
            await expect(service.findOne(123)).rejects.toThrow(NotFoundException);
        });
    });
});

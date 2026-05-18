import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AgentExpirationService } from '../../../src/agent/agent-expiration.service';
import { AgentEntity } from '../../../src/agent/agent.entity';
import { AgentService } from '../../../src/agent/agent.service';

function createMockAgentRepo() {
    const store = new Map<number, any>();
    return {
        store,
        find: jest.fn(async () => {
            // The service only filters by `Not(IsNull())` on expiresAt at the
            // SQL level. The mock returns everything; the service does its
            // own date comparison afterwards. We approximate the FindOptions
            // filter by returning rows whose `expiresAt` is not null.
            return [...store.values()].filter((r) => r.expiresAt != null);
        }),
    };
}

describe('AgentExpirationService', () => {
    let service: AgentExpirationService;
    let agentRepo: ReturnType<typeof createMockAgentRepo>;
    let agentService: { remove: jest.Mock };

    beforeEach(async () => {
        agentRepo = createMockAgentRepo();
        agentService = {
            remove: jest.fn(async (id: number) => {
                agentRepo.store.delete(id);
            }),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AgentExpirationService,
                { provide: getRepositoryToken(AgentEntity), useValue: agentRepo },
                { provide: AgentService, useValue: agentService },
            ],
        }).compile();
        service = module.get(AgentExpirationService);
    });

    function seed(rows: Array<{ id: number; name: string; expiresAt: Date | null; pinned?: boolean }>) {
        for (const r of rows) agentRepo.store.set(r.id, { pinned: false, ...r });
    }

    it('does nothing when no agent has expiresAt set', async () => {
        seed([{ id: 1, name: 'Pinned', expiresAt: null, pinned: true }]);
        await service.runDailyCleanup();
        expect(agentService.remove).not.toHaveBeenCalled();
        expect(agentRepo.store.size).toBe(1);
    });

    it('removes only expired agents', async () => {
        const now = Date.now();
        seed([
            { id: 1, name: 'Pinned', expiresAt: null, pinned: true },
            { id: 2, name: 'Expired', expiresAt: new Date(now - 60_000) },
            { id: 3, name: 'NotYet', expiresAt: new Date(now + 60_000) },
        ]);
        await service.runDailyCleanup();
        expect(agentService.remove).toHaveBeenCalledTimes(1);
        expect(agentService.remove).toHaveBeenCalledWith(2);
        expect(agentRepo.store.has(1)).toBe(true);
        expect(agentRepo.store.has(3)).toBe(true);
        expect(agentRepo.store.has(2)).toBe(false);
    });

    it('keeps cleaning when one remove() fails', async () => {
        const now = Date.now();
        seed([
            { id: 2, name: 'A', expiresAt: new Date(now - 60_000) },
            { id: 3, name: 'B', expiresAt: new Date(now - 30_000) },
        ]);
        agentService.remove.mockImplementationOnce(async () => {
            throw new Error('vector store unavailable');
        });
        await service.runDailyCleanup();
        expect(agentService.remove).toHaveBeenCalledTimes(2);
        // The second one still ran.
        expect(agentService.remove).toHaveBeenNthCalledWith(2, 3);
    });

    it('delegates to AgentService.remove (which handles the cascade)', async () => {
        // The expiration service does NOT touch indexed_files, vectors or
        // the filesystem directly — it goes through AgentService.remove so
        // the cascade and "do not touch disk" policy stay in one place.
        seed([{ id: 7, name: 'X', expiresAt: new Date(Date.now() - 1_000) }]);
        await service.runDailyCleanup();
        expect(agentService.remove).toHaveBeenCalledWith(7);
    });
});

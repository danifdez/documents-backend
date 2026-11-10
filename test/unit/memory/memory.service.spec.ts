import { NotFoundException } from '@nestjs/common';
import { MemoryService } from '../../../src/memory/memory.service';
import { createMockRepository } from '../../test-utils';

describe('MemoryService ownership', () => {
  let service: MemoryService;
  let memoryRepo: ReturnType<typeof createMockRepository>;
  let assistantRepo: ReturnType<typeof createMockRepository>;
  let agentRepo: ReturnType<typeof createMockRepository>;

  beforeEach(() => {
    memoryRepo = createMockRepository();
    assistantRepo = createMockRepository();
    agentRepo = createMockRepository();
    service = new MemoryService(
      memoryRepo as any,
      assistantRepo as any,
      agentRepo as any,
    );
  });

  it('lists memory only when the assistant belongs to the principal', async () => {
    assistantRepo.findOneBy.mockResolvedValue({
      id: 1,
      ownerPrincipal: 'user-a',
    });
    memoryRepo.find.mockResolvedValue([
      { id: 'entry-1', name: 'Fact', type: 'fact', body: 'Body' },
    ]);

    await expect(service.list('assistant', 1, 'user-a')).resolves.toHaveLength(
      1,
    );
    expect(assistantRepo.findOneBy).toHaveBeenCalledWith({
      id: 1,
      ownerPrincipal: 'user-a',
    });
  });

  it('rejects memory access when the assistant belongs to another principal', async () => {
    assistantRepo.findOneBy.mockResolvedValue(null);

    await expect(service.list('assistant', 1, 'user-b')).rejects.toThrow(
      NotFoundException,
    );
    expect(memoryRepo.find).not.toHaveBeenCalled();
  });

  it('rejects memory access when the agent belongs to another principal', async () => {
    agentRepo.findOneBy.mockResolvedValue(null);

    await expect(service.clear('agent', 2, 'user-b')).rejects.toThrow(
      NotFoundException,
    );
    expect(memoryRepo.delete).not.toHaveBeenCalled();
  });
});

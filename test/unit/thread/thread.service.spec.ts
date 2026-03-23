import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ThreadService } from '../../../src/thread/thread.service';
import { ThreadEntity } from '../../../src/thread/thread.entity';
import { createMockRepository, MockRepository } from '../../test-utils';
import { buildThread } from '../../factories';

describe('ThreadService', () => {
  let service: ThreadService;
  let repo: MockRepository<ThreadEntity>;

  beforeEach(async () => {
    repo = createMockRepository();
    const module: TestingModule = await Test.createTestingModule({
      providers: [ThreadService, { provide: getRepositoryToken(ThreadEntity), useValue: repo }],
    }).compile();
    service = module.get(ThreadService);
  });

  it('should find one', async () => {
    repo.findOneBy.mockResolvedValue(buildThread());
    expect(await service.findOne(1)).toBeDefined();
  });

  it('should create thread', async () => {
    const t = buildThread();
    repo.create.mockReturnValue(t);
    repo.save.mockResolvedValue(t);
    expect(await service.create({ name: 'Test' })).toEqual(t);
  });

  it('should find by project', async () => {
    repo.find.mockResolvedValue([buildThread()]);
    expect(await service.findByProject(1)).toHaveLength(1);
  });
});

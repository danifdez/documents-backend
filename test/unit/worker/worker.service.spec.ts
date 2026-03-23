import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WorkerService } from '../../../src/worker/worker.service';
import { WorkerEntity } from '../../../src/worker/worker.entity';
import { createMockRepository, MockRepository } from '../../test-utils';
import { buildWorker } from '../../factories';

describe('WorkerService', () => {
  let service: WorkerService;
  let repo: MockRepository<WorkerEntity>;

  beforeEach(async () => {
    repo = createMockRepository();
    const module: TestingModule = await Test.createTestingModule({
      providers: [WorkerService, { provide: getRepositoryToken(WorkerEntity), useValue: repo }],
    }).compile();
    service = module.get(WorkerService);
  });

  it('should find all workers', async () => {
    repo.find.mockResolvedValue([buildWorker()]);
    expect(await service.findAll()).toHaveLength(1);
  });

  it('should find online workers', async () => {
    repo.find.mockResolvedValue([buildWorker()]);
    expect(await service.findOnline()).toHaveLength(1);
  });

  it('should find by id', async () => {
    repo.findOneBy.mockResolvedValue(buildWorker());
    expect(await service.findById('test-uuid')).toBeDefined();
  });
});

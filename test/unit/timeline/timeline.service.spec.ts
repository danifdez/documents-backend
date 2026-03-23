import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TimelineService } from '../../../src/timeline/timeline.service';
import { TimelineEntity } from '../../../src/timeline/timeline.entity';
import { createMockRepository, MockRepository } from '../../test-utils';
import { buildTimeline } from '../../factories';

describe('TimelineService', () => {
  let service: TimelineService;
  let repo: MockRepository<TimelineEntity>;

  beforeEach(async () => {
    repo = createMockRepository();
    const module: TestingModule = await Test.createTestingModule({
      providers: [TimelineService, { provide: getRepositoryToken(TimelineEntity), useValue: repo }],
    }).compile();
    service = module.get(TimelineService);
  });

  it('should find one with project', async () => {
    repo.findOne.mockResolvedValue(buildTimeline());
    expect(await service.findOne(1)).toBeDefined();
  });

  it('should create timeline', async () => {
    const t = buildTimeline();
    repo.create.mockReturnValue(t);
    repo.save.mockResolvedValue(t);
    expect(await service.create({ name: 'Test' })).toEqual(t);
  });

  it('should find by project', async () => {
    const qb = repo.createQueryBuilder();
    qb.getMany.mockResolvedValue([buildTimeline()]);
    expect(await service.findByProject(1)).toHaveLength(1);
  });

  it('should remove', async () => {
    const t = buildTimeline();
    repo.findOneBy.mockResolvedValue(t);
    repo.remove.mockResolvedValue(t);
    await service.remove(1);
    expect(repo.remove).toHaveBeenCalled();
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MarkService } from '../../../src/mark/mark.service';
import { MarkEntity } from '../../../src/mark/mark.entity';
import { createMockRepository, MockRepository } from '../../test-utils';
import { buildMark } from '../../factories';

describe('MarkService', () => {
  let service: MarkService;
  let repo: MockRepository<MarkEntity>;

  beforeEach(async () => {
    repo = createMockRepository();
    const module: TestingModule = await Test.createTestingModule({
      providers: [MarkService, { provide: getRepositoryToken(MarkEntity), useValue: repo }],
    }).compile();
    service = module.get(MarkService);
  });

  it('should find one', async () => {
    repo.findOneBy.mockResolvedValue(buildMark());
    expect(await service.findOne(1)).toBeDefined();
  });

  it('should create mark', async () => {
    const m = buildMark();
    repo.create.mockReturnValue(m);
    repo.save.mockResolvedValue(m);
    expect(await service.create({ content: 'test' })).toEqual(m);
  });

  it('should find by doc', async () => {
    repo.find.mockResolvedValue([buildMark()]);
    expect(await service.findByDoc(1)).toHaveLength(1);
  });

  it('should find by resource', async () => {
    repo.find.mockResolvedValue([buildMark()]);
    expect(await service.findByResource(1)).toHaveLength(1);
  });

  it('should delete', async () => {
    repo.delete.mockResolvedValue({ affected: 1 });
    await service.delete(1);
    expect(repo.delete).toHaveBeenCalledWith({ id: 1 });
  });
});

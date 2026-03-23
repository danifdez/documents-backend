import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DocService } from '../../../src/doc/doc.service';
import { DocEntity } from '../../../src/doc/doc.entity';
import { createMockRepository, MockRepository } from '../../test-utils';
import { buildDoc } from '../../factories';

describe('DocService', () => {
  let service: DocService;
  let repo: MockRepository<DocEntity>;

  beforeEach(async () => {
    repo = createMockRepository();
    const module: TestingModule = await Test.createTestingModule({
      providers: [DocService, { provide: getRepositoryToken(DocEntity), useValue: repo }],
    }).compile();
    service = module.get(DocService);
  });

  it('should find one by id', async () => {
    repo.findOneBy.mockResolvedValue(buildDoc());
    expect(await service.findOne(1)).toBeDefined();
  });

  it('should create doc', async () => {
    const d = buildDoc();
    repo.create.mockReturnValue(d);
    repo.save.mockResolvedValue(d);
    expect(await service.create({ name: 'Test' })).toEqual(d);
  });

  it('should find by thread', async () => {
    const qb = repo.createQueryBuilder();
    qb.getMany.mockResolvedValue([buildDoc()]);
    expect(await service.findByThread(1)).toHaveLength(1);
  });

  it('should find by project', async () => {
    const qb = repo.createQueryBuilder();
    qb.getMany.mockResolvedValue([buildDoc()]);
    expect(await service.findByProject(1)).toHaveLength(1);
  });

  it('should update doc', async () => {
    const d = buildDoc({ name: 'Updated' });
    repo.preload.mockResolvedValue(d);
    repo.save.mockResolvedValue(d);
    expect(await service.update(1, { name: 'Updated' })).toEqual(d);
  });

  it('should return null on update if not found', async () => {
    repo.preload.mockResolvedValue(undefined);
    expect(await service.update(999, {})).toBeNull();
  });

  it('should remove doc', async () => {
    const d = buildDoc();
    repo.findOneBy.mockResolvedValue(d);
    repo.remove.mockResolvedValue(d);
    await service.remove(1);
    expect(repo.remove).toHaveBeenCalled();
  });
});

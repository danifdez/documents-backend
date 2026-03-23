import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ProjectService } from '../../../src/project/project.service';
import { ProjectEntity } from '../../../src/project/project.entity';
import { createMockRepository, MockRepository } from '../../test-utils';
import { buildProject } from '../../factories';

describe('ProjectService', () => {
  let service: ProjectService;
  let repo: MockRepository<ProjectEntity>;

  beforeEach(async () => {
    repo = createMockRepository();
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProjectService, { provide: getRepositoryToken(ProjectEntity), useValue: repo }],
    }).compile();
    service = module.get(ProjectService);
  });

  it('should find all projects', async () => {
    repo.find.mockResolvedValue([buildProject()]);
    expect(await service.findAll()).toHaveLength(1);
  });

  it('should find one by id', async () => {
    const p = buildProject();
    repo.findOneBy.mockResolvedValue(p);
    expect(await service.findOne(1)).toEqual(p);
  });

  it('should create project', async () => {
    const p = buildProject();
    repo.create.mockReturnValue(p);
    repo.save.mockResolvedValue(p);
    expect(await service.create({ name: 'Test' })).toEqual(p);
  });

  it('should update project', async () => {
    const p = buildProject({ name: 'Updated' });
    repo.findOneBy.mockResolvedValue(p);
    repo.save.mockResolvedValue(p);
    expect(await service.update(1, { name: 'Updated' })).toEqual(p);
  });

  it('should return null on update if not found', async () => {
    repo.findOneBy.mockResolvedValue(null);
    expect(await service.update(999, {})).toBeNull();
  });

  it('should remove project', async () => {
    const p = buildProject();
    repo.findOneBy.mockResolvedValue(p);
    repo.remove.mockResolvedValue(p);
    await service.remove(1);
    expect(repo.remove).toHaveBeenCalledWith(p);
  });

  it('should return all on empty search', async () => {
    repo.find.mockResolvedValue([buildProject()]);
    expect(await service.search('')).toHaveLength(1);
  });

  it('should search by name with query builder', async () => {
    const qb = repo.createQueryBuilder();
    qb.getMany.mockResolvedValue([buildProject()]);
    expect(await service.search('test')).toHaveLength(1);
  });
});

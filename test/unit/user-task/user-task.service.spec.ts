import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserTaskService } from '../../../src/user-task/user-task.service';
import { UserTaskEntity } from '../../../src/user-task/user-task.entity';
import { createMockRepository, MockRepository } from '../../test-utils';
import { buildUserTask } from '../../factories';

describe('UserTaskService', () => {
  let service: UserTaskService;
  let repo: MockRepository<UserTaskEntity>;

  beforeEach(async () => {
    repo = createMockRepository();
    const module: TestingModule = await Test.createTestingModule({
      providers: [UserTaskService, { provide: getRepositoryToken(UserTaskEntity), useValue: repo }],
    }).compile();
    service = module.get(UserTaskService);
  });

  it('should find all', async () => {
    repo.find.mockResolvedValue([buildUserTask()]);
    expect(await service.findAll()).toHaveLength(1);
  });

  it('should find one', async () => {
    repo.findOne.mockResolvedValue(buildUserTask());
    expect(await service.findOne(1)).toBeDefined();
  });

  it('should find by project', async () => {
    const qb = repo.createQueryBuilder();
    qb.getMany.mockResolvedValue([buildUserTask()]);
    expect(await service.findByProject(1)).toHaveLength(1);
  });

  it('should create task', async () => {
    const t = buildUserTask();
    repo.create.mockReturnValue(t);
    repo.save.mockResolvedValue(t);
    expect(await service.create({ title: 'Test' })).toEqual(t);
  });

  it('should update task', async () => {
    const t = buildUserTask({ title: 'Updated' });
    repo.preload.mockResolvedValue(t);
    repo.save.mockResolvedValue(t);
    expect(await service.update(1, { title: 'Updated' })).toEqual(t);
  });

  it('should remove task', async () => {
    const t = buildUserTask();
    repo.findOneBy.mockResolvedValue(t);
    repo.remove.mockResolvedValue(t);
    await service.remove(1);
    expect(repo.remove).toHaveBeenCalled();
  });
});

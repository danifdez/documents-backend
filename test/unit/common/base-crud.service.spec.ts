import { BaseCrudService } from '../../../src/common/base-crud.service';
import { createMockRepository, MockRepository } from '../../test-utils';

class TestEntity {
  id: number;
  name: string;
}

class TestService extends BaseCrudService<TestEntity> {
  constructor(repo: any) {
    super(repo);
  }
}

describe('BaseCrudService', () => {
  let service: TestService;
  let repo: MockRepository<TestEntity>;

  beforeEach(() => {
    repo = createMockRepository<TestEntity>();
    service = new TestService(repo);
  });

  describe('findOne', () => {
    it('should find entity by id', async () => {
      const entity = { id: 1, name: 'Test' };
      repo.findOne.mockResolvedValue(entity);
      expect(await service.findOne(1)).toEqual(entity);
    });

    it('should return null if not found', async () => {
      repo.findOne.mockResolvedValue(null);
      expect(await service.findOne(999)).toBeNull();
    });
  });

  describe('findAll', () => {
    it('should return all entities', async () => {
      const entities = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }];
      repo.find.mockResolvedValue(entities);
      expect(await service.findAll()).toEqual(entities);
    });
  });

  describe('create', () => {
    it('should create and save entity', async () => {
      const entity = { id: 1, name: 'New' };
      repo.create.mockReturnValue(entity);
      repo.save.mockResolvedValue(entity);
      expect(await service.create({ name: 'New' } as any)).toEqual(entity);
    });
  });

  describe('update', () => {
    it('should update existing entity', async () => {
      const entity = { id: 1, name: 'Updated' };
      repo.preload.mockResolvedValue(entity);
      repo.save.mockResolvedValue(entity);
      expect(await service.update(1, { name: 'Updated' } as any)).toEqual(entity);
    });

    it('should return null if not found', async () => {
      repo.preload.mockResolvedValue(undefined);
      expect(await service.update(999, {} as any)).toBeNull();
    });
  });

  describe('remove', () => {
    it('should remove entity', async () => {
      const entity = { id: 1, name: 'Del' };
      repo.findOneBy.mockResolvedValue(entity);
      repo.remove.mockResolvedValue(entity);
      expect(await service.remove(1)).toEqual(entity);
    });

    it('should return null if not found', async () => {
      repo.findOneBy.mockResolvedValue(null);
      expect(await service.remove(999)).toBeNull();
    });
  });
});

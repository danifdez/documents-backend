import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ResourceTypeService } from '../../../src/resource-type/resource-type.service';
import { ResourceTypeEntity } from '../../../src/resource-type/resource-type.entity';
import { createMockRepository, MockRepository } from '../../test-utils';
import { buildResourceType } from '../../factories';

describe('ResourceTypeService', () => {
  let service: ResourceTypeService;
  let repo: MockRepository<ResourceTypeEntity>;

  beforeEach(async () => {
    repo = createMockRepository<ResourceTypeEntity>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResourceTypeService,
        { provide: getRepositoryToken(ResourceTypeEntity), useValue: repo },
      ],
    }).compile();

    service = module.get(ResourceTypeService);
  });

  describe('findAll', () => {
    it('should return all resource types ordered by createdAt DESC', async () => {
      const types = [buildResourceType(), buildResourceType({ id: 2, name: 'Book' })];
      repo.find.mockResolvedValue(types);
      expect(await service.findAll()).toEqual(types);
      expect(repo.find).toHaveBeenCalledWith({ order: { createdAt: 'DESC' } });
    });
  });

  describe('findOne', () => {
    it('should find by id', async () => {
      const type = buildResourceType();
      repo.findOneBy.mockResolvedValue(type);
      expect(await service.findOne(1)).toEqual(type);
    });

    it('should return null when not found', async () => {
      repo.findOneBy.mockResolvedValue(null);
      expect(await service.findOne(999)).toBeNull();
    });
  });

  describe('create', () => {
    it('should create and save a resource type', async () => {
      const type = buildResourceType({ name: 'Report', abbreviation: 'RPT' });
      repo.create.mockReturnValue(type);
      repo.save.mockResolvedValue(type);
      const result = await service.create({ name: 'Report', abbreviation: 'RPT' });
      expect(result).toEqual(type);
    });
  });

  describe('update', () => {
    it('should update an existing resource type', async () => {
      const type = buildResourceType({ name: 'Updated' });
      repo.preload.mockResolvedValue(type);
      repo.save.mockResolvedValue(type);
      expect(await service.update(1, { name: 'Updated' })).toEqual(type);
    });

    it('should return null if not found', async () => {
      repo.preload.mockResolvedValue(undefined);
      expect(await service.update(999, { name: 'X' })).toBeNull();
    });
  });

  describe('remove', () => {
    it('should delete by id', async () => {
      repo.delete.mockResolvedValue({ affected: 1 });
      await service.remove(1);
      expect(repo.delete).toHaveBeenCalledWith({ id: 1 });
    });
  });
});

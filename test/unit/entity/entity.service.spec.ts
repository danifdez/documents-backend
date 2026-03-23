import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { EntityService } from '../../../src/entity/entity.service';
import { EntityEntity } from '../../../src/entity/entity.entity';
import { EntityTypeService } from '../../../src/entity-type/entity-type.service';
import { ResourceService } from '../../../src/resource/resource.service';
import { createMockRepository, MockRepository } from '../../test-utils';
import { buildEntity, buildEntityType, buildResource } from '../../factories';

describe('EntityService', () => {
  let service: EntityService;
  let repo: MockRepository<EntityEntity>;
  let entityTypeService: Record<string, jest.Mock>;
  let resourceService: Record<string, jest.Mock>;

  beforeEach(async () => {
    repo = createMockRepository();
    entityTypeService = { findOne: jest.fn(), findByName: jest.fn() };
    resourceService = { findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EntityService,
        { provide: getRepositoryToken(EntityEntity), useValue: repo },
        { provide: EntityTypeService, useValue: entityTypeService },
        { provide: ResourceService, useValue: resourceService },
      ],
    }).compile();
    service = module.get(EntityService);
  });

  describe('findAll', () => {
    it('should return all entities', async () => {
      repo.find.mockResolvedValue([buildEntity()]);
      expect(await service.findAll()).toHaveLength(1);
    });
  });

  describe('findOne', () => {
    it('should return entity by id', async () => {
      const e = buildEntity();
      repo.findOne.mockResolvedValue(e);
      expect(await service.findOne(1)).toEqual(e);
    });
  });

  describe('create', () => {
    it('should create entity with valid entityType', async () => {
      const et = buildEntityType();
      entityTypeService.findOne.mockResolvedValue(et);
      const entity = buildEntity();
      repo.create.mockReturnValue(entity);
      repo.save.mockResolvedValue(entity);

      const result = await service.create({ name: 'Test', entityTypeId: 1 });
      expect(result).toEqual(entity);
    });

    it('should throw NotFoundException if entityType not found', async () => {
      entityTypeService.findOne.mockResolvedValue(null);
      await expect(service.create({ name: 'Test', entityTypeId: 999 })).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update entity', async () => {
      const entity = buildEntity();
      repo.findOne.mockResolvedValue(entity);
      repo.save.mockResolvedValue({ ...entity, name: 'Updated' });
      const result = await service.update(1, { name: 'Updated' });
      expect(result.name).toBe('Updated');
    });

    it('should return null if not found', async () => {
      repo.findOne.mockResolvedValue(null);
      expect(await service.update(999, {})).toBeNull();
    });
  });

  describe('remove', () => {
    it('should delete entity', async () => {
      repo.delete.mockResolvedValue({ affected: 1 });
      await service.remove(1);
      expect(repo.delete).toHaveBeenCalledWith({ id: 1 });
    });
  });

  describe('merge', () => {
    it('should throw NotFoundException if source not found', async () => {
      repo.findOne.mockResolvedValueOnce(null);
      await expect(service.merge(999, 1)).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if target not found', async () => {
      repo.findOne.mockResolvedValueOnce(buildEntity({ id: 1 }));
      repo.findOne.mockResolvedValueOnce(null);
      await expect(service.merge(1, 999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findOrCreate', () => {
    it('should return existing entity if found', async () => {
      const et = buildEntityType();
      entityTypeService.findByName.mockResolvedValue(et);
      const entity = buildEntity();
      repo.findOne.mockResolvedValue(entity);

      const result = await service.findOrCreate('Test', 'Person');
      expect(result).toEqual(entity);
    });

    it('should throw NotFoundException if entity type name not found', async () => {
      entityTypeService.findByName.mockResolvedValue(null);
      await expect(service.findOrCreate('Test', 'Unknown')).rejects.toThrow(NotFoundException);
    });
  });

  describe('searchByName', () => {
    it('should return empty for blank search', async () => {
      expect(await service.searchByName('')).toEqual([]);
    });

    it('should search entities', async () => {
      const qb = repo.createQueryBuilder();
      qb.getMany.mockResolvedValue([buildEntity()]);
      const result = await service.searchByName('test');
      expect(result).toHaveLength(1);
    });
  });
});

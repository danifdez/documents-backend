import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EntityTypeService } from '../../../src/entity-type/entity-type.service';
import { EntityTypeEntity } from '../../../src/entity-type/entity-type.entity';
import { createMockRepository, MockRepository } from '../../test-utils';
import { buildEntityType } from '../../factories';

describe('EntityTypeService', () => {
  let service: EntityTypeService;
  let repo: MockRepository<EntityTypeEntity>;

  beforeEach(async () => {
    repo = createMockRepository();
    const module: TestingModule = await Test.createTestingModule({
      providers: [EntityTypeService, { provide: getRepositoryToken(EntityTypeEntity), useValue: repo }],
    }).compile();
    service = module.get(EntityTypeService);
  });

  it('should find all', async () => {
    repo.find.mockResolvedValue([buildEntityType()]);
    expect(await service.findAll()).toHaveLength(1);
  });

  it('should find one by id', async () => {
    const et = buildEntityType();
    repo.findOne.mockResolvedValue(et);
    expect(await service.findOne(1)).toEqual(et);
  });

  it('should find by name', async () => {
    const et = buildEntityType({ name: 'Person' });
    repo.findOne.mockResolvedValue(et);
    expect(await service.findByName('Person')).toEqual(et);
  });

  it('should create', async () => {
    const et = buildEntityType();
    repo.create.mockReturnValue(et);
    repo.save.mockResolvedValue(et);
    expect(await service.create({ name: 'Person' })).toEqual(et);
  });

  it('should remove', async () => {
    repo.delete.mockResolvedValue({ affected: 1 });
    await service.remove(1);
    expect(repo.delete).toHaveBeenCalledWith({ id: 1 });
  });
});

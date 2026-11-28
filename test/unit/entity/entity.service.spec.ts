import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { Brackets } from 'typeorm';
import { EntityService } from '../../../src/entity/entity.service';
import { EntityEntity } from '../../../src/entity/entity.entity';
import { EntityTypeService } from '../../../src/entity-type/entity-type.service';
import { ResourceService } from '../../../src/resource/resource.service';
import {
  createMockQueryBuilder,
  createMockRepository,
  MockRepository,
} from '../../test-utils';
import { buildEntity, buildEntityType } from '../../factories';

describe('EntityService', () => {
  let service: EntityService;
  let repo: MockRepository<EntityEntity>;
  let entityTypeService: Record<string, jest.Mock>;
  let resourceService: Record<string, jest.Mock>;

  beforeEach(async () => {
    repo = createMockRepository();
    const manager = repo.manager as any;
    manager.query = jest.fn().mockResolvedValue([]);
    manager.getRepository = jest.fn().mockReturnValue(repo);
    manager.transaction = jest.fn(async (work: (m: any) => unknown) =>
      work(manager),
    );
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

    it('should persist the description on create', async () => {
      const et = buildEntityType();
      entityTypeService.findOne.mockResolvedValue(et);
      const entity = buildEntity();
      repo.create.mockReturnValue(entity);
      repo.save.mockResolvedValue(entity);

      await service.create({
        name: 'Test',
        entityTypeId: 1,
        description: 'Fuente: https://example.com',
      });
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'Fuente: https://example.com' }),
      );
    });

    it('should throw NotFoundException if entityType not found', async () => {
      entityTypeService.findOne.mockResolvedValue(null);
      await expect(
        service.create({ name: 'Test', entityTypeId: 999 }),
      ).rejects.toThrow(NotFoundException);
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

  describe('findByNameTypeAndLocale', () => {
    it('keeps the entity type filter outside the name/translation/alias OR group', async () => {
      const qb = repo.createQueryBuilder();
      qb.getOne.mockResolvedValue(buildEntity());

      await service.findByNameTypeAndLocale('Ada', 7, 'es');

      expect(qb.where).toHaveBeenCalledWith('entityType.id = :entityTypeId', {
        entityTypeId: 7,
      });
      expect(qb.andWhere).toHaveBeenCalledTimes(1);
      expect((qb.andWhere as jest.Mock).mock.calls[0][0]).toBeInstanceOf(
        Brackets,
      );
      expect(qb.orWhere).not.toHaveBeenCalled();
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

    it('moves project and knowledge references inside one transaction', async () => {
      const source = buildEntity({ id: 1, name: 'Source' });
      const target = buildEntity({ id: 2, name: 'Target' });
      repo.findOne.mockResolvedValueOnce(source).mockResolvedValueOnce(target);
      repo.save.mockResolvedValue(target);
      repo.delete.mockResolvedValue({ affected: 1 });

      await service.merge(1, 2);

      expect((repo.manager as any).transaction).toHaveBeenCalledTimes(1);
      expect((repo.manager as any).query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO entity_projects'),
        [2, 1],
      );
      expect((repo.manager as any).query).toHaveBeenCalledWith(
        expect.stringContaining('knowledge_entries'),
        [2, 1],
      );
      expect(repo.delete).toHaveBeenCalledWith({ id: 1 });
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
      await expect(service.findOrCreate('Test', 'Unknown')).rejects.toThrow(
        NotFoundException,
      );
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

  it('loads resource project details and related knowledge for an entity', async () => {
    await expect(service.findOneDetailed(1)).resolves.toBeNull();
    const entity = buildEntity();
    repo.findOne.mockResolvedValue(entity);
    repo.query
      .mockResolvedValueOnce([
        {
          id: 10,
          name: 'Report',
          type: 'pdf',
          status: 'confirmed',
          projectId: 2,
          projectName: 'Catalog',
        },
        {
          id: 11,
          name: 'Other',
          type: 'text',
          status: 'draft',
          projectId: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 20,
          title: 'Evidence',
          summary: 'A summary',
          ignored: 'not returned',
        },
      ]);
    await expect(service.findOneDetailed(1)).resolves.toMatchObject({
      id: entity.id,
      resources: [
        {
          id: 10,
          name: 'Report',
          type: 'pdf',
          status: 'confirmed',
          project: { id: 2, name: 'Catalog' },
        },
        { id: 11, name: 'Other', type: 'text', status: 'draft', project: null },
      ],
      knowledgeEntries: [{ id: 20, title: 'Evidence', summary: 'A summary' }],
    });
    expect(repo.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('WHERE entity_id = $1'),
      [1],
    );
  });

  it('finds exact names and only restricts global results when a project is supplied', async () => {
    const result = buildEntity();
    repo.findOne.mockResolvedValue(result);
    await expect(service.findByName('Ada')).resolves.toBe(result);
    expect(repo.findOne).toHaveBeenCalledWith({
      where: { name: 'Ada' },
      relations: { entityType: true },
    });
    const qb = repo.createQueryBuilder();
    qb.getRawMany.mockResolvedValue([{ e_id: 1 }]);
    await expect(service.globalSearch('Ada', 2)).resolves.toEqual([
      { e_id: 1 },
    ]);
    expect(qb.innerJoin).toHaveBeenCalledWith(
      'entity_projects',
      'ep',
      'ep.entity_id = e.id',
    );
    expect(qb.andWhere).toHaveBeenCalledWith('ep.project_id = :projectId', {
      projectId: 2,
    });
    qb.innerJoin.mockClear();
    await service.globalSearch('Ada');
    expect(qb.innerJoin).not.toHaveBeenCalled();
  });

  it('groups entities by scope and excludes other projects', async () => {
    const rows = [
      {
        in_document_count: '2',
        in_project_count: '2',
        total_resource_count: '3',
      },
      {
        in_document_count: '0',
        in_project_count: '1',
        total_resource_count: '4',
      },
      {
        in_document_count: '0',
        in_project_count: '0',
        total_resource_count: undefined,
      },
      {
        in_document_count: '0',
        in_project_count: '0',
        total_resource_count: '2',
      },
    ];
    const items = rows.map((_, id) => buildEntity({ id: id + 1 }));
    const qb = createMockQueryBuilder();
    const aggregate = {
      ...qb,
      getRawAndEntities: jest
        .fn()
        .mockResolvedValue({ entities: items, raw: rows }),
    };
    for (const key of [
      'leftJoinAndSelect',
      'addSelect',
      'setParameter',
      'where',
      'orderBy',
    ] as const) {
      aggregate[key].mockReturnValue(aggregate);
    }
    repo.createQueryBuilder.mockReturnValue(aggregate);
    await expect(service.findByResourceGroupedByScope(7)).resolves.toEqual({
      document: [],
      project: [],
      global: [],
    });
    expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    resourceService.findOne
      .mockResolvedValueOnce({ project: { id: 2 } })
      .mockResolvedValueOnce({});
    await expect(
      service.findByResourceGroupedByScope(7, ' Ada '),
    ).resolves.toEqual({
      document: [items[0]],
      project: [items[1]],
      global: [items[2]],
    });
    expect(aggregate.setParameter.mock.calls).toEqual([
      ['resourceId', 7],
      ['projectId', 2],
    ]);
    expect(aggregate.where).toHaveBeenCalledWith(
      expect.stringContaining('jsonb_array_elements'),
      { searchTerm: '%Ada%' },
    );
    expect(aggregate.where).toHaveBeenCalledWith(
      expect.stringContaining('jsonb_each_text'),
      { searchTerm: '%Ada%' },
    );

    await expect(service.findByResourceGroupedByScope(7, ' ')).resolves.toEqual(
      {
        document: [items[0]],
        project: [],
        global: [items[2]],
      },
    );
    expect(aggregate.where).toHaveBeenCalledTimes(1);
  });

  it('creates memberships without duplicating project links', async () => {
    const entityType = buildEntityType({ id: 2 });
    const saved = buildEntity({ id: 3, entityType });
    entityTypeService.findOne.mockResolvedValue(entityType);
    repo.create.mockImplementation((row) => row);
    repo.save.mockResolvedValue(saved);
    const qb = repo.createQueryBuilder();

    await expect(
      service.create({
        name: 'Ada',
        entityTypeId: 2,
        projectIds: [5, 6],
        global: true,
      }),
    ).resolves.toBe(saved);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ global: true }),
    );
    expect(qb.values).toHaveBeenCalledWith([
      { entity_id: 3, project_id: 5 },
      { entity_id: 3, project_id: 6 },
    ]);
    qb.values.mockClear();
    qb.getRawOne
      .mockResolvedValueOnce({ exists: 1 })
      .mockResolvedValueOnce(null);
    await service.addProjectToEntity(3, 5);
    expect(qb.values).not.toHaveBeenCalled();
    await service.addProjectToEntity(3, 7);
    expect(qb.values).toHaveBeenCalledWith({ entity_id: 3, project_id: 7 });
  });

  it('updates entity metadata, validates type changes and replaces memberships', async () => {
    const entity = buildEntity({
      id: 3,
      entityType: buildEntityType({ id: 1 }),
    });
    const newType = buildEntityType({ id: 2 });
    repo.findOne.mockResolvedValue(entity);
    repo.save.mockImplementation(async (row) => row);
    entityTypeService.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValue(newType);
    await expect(service.update(3, { entityTypeId: 2 })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repo.save).not.toHaveBeenCalled();
    const qb = repo.createQueryBuilder();
    const metadata = {
      description: null,
      aliases: [{ locale: 'en', value: 'A' }],
      translations: { es: 'Ada' },
      global: true,
    };
    await expect(
      service.update(3, { ...metadata, entityTypeId: 2, projectIds: [4] }),
    ).resolves.toMatchObject({
      ...metadata,
      entityType: newType,
    });
    expect(qb.delete).toHaveBeenCalledTimes(1);
    expect(qb.where).toHaveBeenCalledWith('entity_id = :entityId', {
      entityId: 3,
    });
    expect(qb.values).toHaveBeenCalledWith([{ entity_id: 3, project_id: 4 }]);
    qb.values.mockClear();
    await service.update(3, { entityTypeId: 2, projectIds: [] });
    expect(qb.delete).toHaveBeenCalledTimes(2);
    expect(qb.values).not.toHaveBeenCalled();
    expect(entityTypeService.findOne).toHaveBeenCalledTimes(2);
  });

  it('copies translated aliases and preserves target translations', async () => {
    const source = buildEntity({
      id: 1,
      name: 'Source',
      aliases: [
        { locale: 'en', value: 'Shared' },
        { locale: 'es', value: 'Unique' },
      ],
      translations: { es: 'Origen', fr: 'Source FR', it: '' },
    });
    const target = buildEntity({
      id: 2,
      name: 'Target',
      aliases: [
        { locale: 'en', value: 'Source' },
        { locale: 'en', value: 'Shared' },
      ],
      translations: { es: 'Destino', de: 'Ziel' },
    });
    repo.findOne.mockResolvedValueOnce(source).mockResolvedValueOnce(target);
    const merged = await service.merge(1, 2);
    expect(merged.translations).toMatchObject({
      es: 'Destino',
      de: 'Ziel',
      fr: 'Source FR',
    });
    expect(merged.aliases).toEqual([
      { locale: 'en', value: 'Source' },
      { locale: 'en', value: 'Shared' },
      { locale: 'es', value: 'Unique' },
      { locale: 'es', value: 'Origen' },
      { locale: 'fr', value: 'Source FR' },
      { locale: 'es', value: 'Destino' },
      { locale: 'de', value: 'Ziel' },
    ]);
    expect(repo.save).toHaveBeenCalledWith(merged);
    expect(repo.delete).toHaveBeenCalledWith({ id: 1 });
  });

  it('queries entities attached to a resource and creates a previously unseen name', async () => {
    const entityType = buildEntityType({ id: 2 });
    const entity = buildEntity({ name: 'Ada', entityType });
    const qb = repo.createQueryBuilder();
    qb.getMany.mockResolvedValue([entity]);
    await expect(service.findByResourceId(7)).resolves.toEqual([entity]);
    expect(qb.where).toHaveBeenCalledWith('re.resource_id = :resourceId', {
      resourceId: 7,
    });
    entityTypeService.findByName.mockResolvedValue(entityType);
    entityTypeService.findOne.mockResolvedValue(entityType);
    repo.findOne.mockResolvedValue(null);
    repo.create.mockReturnValue(entity);
    repo.save.mockResolvedValue(entity);
    const aliases = [{ locale: 'en', value: 'A' }];
    await expect(service.findOrCreate('Ada', 'Person', aliases)).resolves.toBe(
      entity,
    );
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Ada', aliases, entityType }),
    );
  });
});

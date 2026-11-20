import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HttpException, NotFoundException } from '@nestjs/common';
import { ResourceService } from '../../../src/resource/resource.service';
import { ResourceEntity } from '../../../src/resource/resource.entity';
import { FileStorageService } from '../../../src/file-storage/file-storage.service';
import { ExecutionService } from '../../../src/execution/execution.service';
import { AgeGraphService } from '../../../src/graph/age-graph.service';
import { createMockRepository, MockRepository } from '../../test-utils';
import { buildAuthor, buildEntity, buildResource } from '../../factories';

describe('ResourceService', () => {
  const scope = { ownerPrincipal: 'user-7' };
  const extractionId = '01234567-89ab-4def-8123-456789abcdef';
  let service: ResourceService;
  let repo: MockRepository<ResourceEntity>;
  let fileStorage: Record<string, jest.Mock>;
  let executionService: Record<string, jest.Mock>;
  let graphService: Record<string, jest.Mock>;

  beforeEach(async () => {
    repo = createMockRepository<ResourceEntity>();
    fileStorage = {
      calculateHash: jest.fn(),
      storeFile: jest.fn(),
      getFile: jest.fn(),
      deleteFile: jest.fn(),
    };
    executionService = { create: jest.fn() };
    graphService = { deleteByResource: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResourceService,
        { provide: getRepositoryToken(ResourceEntity), useValue: repo },
        { provide: FileStorageService, useValue: fileStorage },
        { provide: ExecutionService, useValue: executionService },
        { provide: AgeGraphService, useValue: graphService },
      ],
    }).compile();

    service = module.get(ResourceService);
  });

  describe('findOne', () => {
    it('should return a resource by id', async () => {
      const resource = buildResource();
      repo.findOne.mockResolvedValue(resource);
      expect(await service.findOne(1)).toEqual(resource);
    });

    it('should return null if not found', async () => {
      repo.findOne.mockResolvedValue(null);
      expect(await service.findOne(999)).toBeNull();
    });
  });

  describe('getContentById', () => {
    it('should return content', async () => {
      repo.findOne.mockResolvedValue({ content: '<p>test</p>' });
      expect(await service.getContentById(1)).toBe('<p>test</p>');
    });

    it('should return null if no resource', async () => {
      repo.findOne.mockResolvedValue(null);
      expect(await service.getContentById(1)).toBeNull();
    });
  });

  describe('create', () => {
    it('should create and save resource', async () => {
      const resource = buildResource();
      repo.create.mockReturnValue(resource);
      repo.save.mockResolvedValue(resource);
      expect(await service.create({ name: 'test' })).toEqual(resource);
    });
  });

  describe('update', () => {
    it('should update existing resource', async () => {
      const resource = buildResource({ name: 'Updated' });
      repo.preload.mockResolvedValue(resource);
      repo.save.mockResolvedValue(resource);
      expect(await service.update(1, { name: 'Updated' })).toEqual(resource);
    });

    it('should return null if not found', async () => {
      repo.preload.mockResolvedValue(undefined);
      expect(await service.update(999, { name: 'x' })).toBeNull();
    });

    it('rebuilds date extraction as a durable workflow when its anchor changes', async () => {
      const resource = buildResource({
        publicationDate: '2026-08-25' as any,
        language: 'es',
      });
      repo.findOne
        .mockResolvedValueOnce({ id: 1, publicationDate: null })
        .mockResolvedValueOnce({ content: '<p>El 20 de julio de 1969.</p>' });
      repo.preload.mockResolvedValue(resource);
      repo.save.mockResolvedValue(resource);
      executionService.create.mockResolvedValue({ executionId: 'execution-1' });

      await service.update(1, { publicationDate: '2026-08-25' as any });

      expect(executionService.create).toHaveBeenCalledWith(
        'date-extraction',
        expect.any(String),
        { resourceId: 1 },
        {
          steps: [
            expect.objectContaining({
              stepKind: 'inference',
              requiredCapabilities: ['date-extraction-map'],
            }),
            expect.objectContaining({
              stepKind: 'code',
              requiredCapabilities: ['date-extraction-reduce'],
            }),
          ],
        },
      );
    });
  });

  describe('remove', () => {
    it('should remove and return resource', async () => {
      const resource = buildResource();
      repo.findOneBy.mockResolvedValue(resource);
      repo.remove.mockResolvedValue(resource);
      expect(await service.remove(1)).toEqual(resource);
    });

    it('should return null if not found', async () => {
      repo.findOneBy.mockResolvedValue(null);
      expect(await service.remove(999)).toBeNull();
    });
  });

  describe('resourceExists', () => {
    it('should return true if exists', async () => {
      repo.count.mockResolvedValue(1);
      expect(await service.resourceExists(1)).toBe(true);
    });

    it('should return false if not exists', async () => {
      repo.count.mockResolvedValue(0);
      expect(await service.resourceExists(999)).toBe(false);
    });
  });

  describe('confirmExtraction', () => {
    it('should confirm extraction and create a detect-language execution', async () => {
      const resource = buildResource({ status: 'extracted' });
      repo.findOne.mockResolvedValue(resource);
      repo.preload.mockResolvedValue(resource);
      repo.save.mockResolvedValue(resource);
      // getContentById call
      repo.findOne
        .mockResolvedValueOnce(resource) // findOne in confirmExtraction
        .mockResolvedValueOnce({ content: '<p>Hello world</p>' }); // getContentById

      executionService.create.mockResolvedValue({ executionId: extractionId });

      const result = await service.confirmExtraction(1, {
        ownerPrincipal: '42',
      });
      expect(result.success).toBe(true);
      expect(result.executionId).toBe(extractionId);
      expect(executionService.create).toHaveBeenCalledWith(
        'detect-language',
        expect.any(String),
        expect.objectContaining({ resourceId: 1 }),
        { ownerPrincipal: '42' },
      );
    });

    it('should throw NotFoundException if resource not found', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(
        service.confirmExtraction(999, { ownerPrincipal: '42' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw if resource is not in extracted state', async () => {
      repo.findOne.mockResolvedValue(buildResource({ status: 'extracting' }));
      await expect(
        service.confirmExtraction(1, { ownerPrincipal: '42' }),
      ).rejects.toThrow(HttpException);
    });
  });

  describe('uploadAndProcess', () => {
    const mockFile = {
      buffer: Buffer.from('test'),
      originalname: 'test.pdf',
      mimetype: 'application/pdf',
      size: 4,
    } as Express.Multer.File;

    it('should upload, create resource, and create extraction execution', async () => {
      fileStorage.calculateHash.mockReturnValue('hash123');
      repo.findOne.mockResolvedValue(null); // findByHash
      fileStorage.storeFile.mockResolvedValue({
        hash: 'hash123',
        relativePath: 'has/h12/hash123.pdf',
        extension: '.pdf',
      });
      const created = buildResource({ id: 5 });
      repo.create.mockReturnValue(created);
      repo.save.mockResolvedValue(created);
      executionService.create.mockResolvedValue({ executionId: extractionId });

      const result = await service.uploadAndProcess(scope, mockFile, {});
      expect(result).toEqual({
        success: true,
        resourceId: 5,
        executionId: extractionId,
      });
      expect(executionService.create).toHaveBeenCalledWith(
        'document-extraction',
        expect.any(String),
        expect.objectContaining({ resourceId: 5 }),
        {
          ownerPrincipal: scope.ownerPrincipal,
          inputArtifacts: [
            {
              role: 'document',
              kind: 'source_document',
              mediaType: mockFile.mimetype,
              body: mockFile.buffer,
            },
          ],
        },
      );
    });

    it('should throw AlreadyExistException if hash already exists', async () => {
      fileStorage.calculateHash.mockReturnValue('hash123');
      repo.findOne.mockResolvedValue(buildResource()); // findByHash returns existing
      await expect(
        service.uploadAndProcess(scope, mockFile, {}),
      ).rejects.toThrow('File with the same content already exists');
    });

    it('should not create an extraction execution for images', async () => {
      const imageFile = {
        ...mockFile,
        mimetype: 'image/png',
      } as Express.Multer.File;
      fileStorage.calculateHash.mockReturnValue('hash456');
      repo.findOne.mockResolvedValue(null);
      fileStorage.storeFile.mockResolvedValue({
        hash: 'hash456',
        relativePath: 'x',
        extension: '.png',
      });
      repo.create.mockReturnValue(buildResource());
      repo.save.mockResolvedValue(buildResource());

      expect(await service.uploadAndProcess(scope, imageFile, {})).toEqual({
        success: true,
        resourceId: buildResource().id,
        executionId: null,
      });
      expect(executionService.create).not.toHaveBeenCalled();
    });
  });

  describe('getFileBuffer', () => {
    it('should return buffer and resource', async () => {
      const resource = buildResource({
        path: 'some/path.pdf',
        mimeType: 'application/pdf',
      });
      repo.findOne.mockResolvedValue(resource);
      const buf = Buffer.from('content');
      fileStorage.getFile.mockResolvedValue(buf);

      const result = await service.getFileBuffer(1);
      expect(result.buffer).toEqual(buf);
      expect(result.resource).toEqual(resource);
    });

    it('should throw NotFoundException if no resource', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.getFileBuffer(999)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if file not on disk', async () => {
      repo.findOne.mockResolvedValue(buildResource({ path: 'some/path.pdf' }));
      fileStorage.getFile.mockResolvedValue(null);
      await expect(service.getFileBuffer(1)).rejects.toThrow(NotFoundException);
    });
  });

  describe('removeWithFile', () => {
    it('should remove resource and delete file', async () => {
      const resource = buildResource({ path: 'some/path.pdf' });
      repo.findOneBy.mockResolvedValue(resource);
      repo.remove.mockResolvedValue(resource);
      fileStorage.deleteFile.mockResolvedValue(true);

      await service.removeWithFile(1);
      expect(graphService.deleteByResource).toHaveBeenCalledWith(1);
      expect(fileStorage.deleteFile).toHaveBeenCalledWith('some/path.pdf');
    });

    it('should not delete file if resource had no path', async () => {
      const resource = buildResource({ path: null });
      repo.findOneBy.mockResolvedValue(resource);
      repo.remove.mockResolvedValue(resource);

      await service.removeWithFile(1);
      expect(fileStorage.deleteFile).not.toHaveBeenCalled();
    });
  });

  describe('junction table operations', () => {
    it('addEntityToResource should insert if not existing', async () => {
      repo.query.mockResolvedValueOnce([]); // check
      repo.query.mockResolvedValueOnce(undefined); // insert
      await service.addEntityToResource(1, { id: 2 } as any);
      expect(repo.query).toHaveBeenCalledTimes(2);
    });

    it('addEntityToResource should skip if already exists', async () => {
      repo.query.mockResolvedValueOnce([{ '?column?': 1 }]); // check
      await service.addEntityToResource(1, { id: 2 } as any);
      expect(repo.query).toHaveBeenCalledTimes(1);
    });

    it('removeEntityFromResource should delete', async () => {
      repo.query.mockResolvedValue(undefined);
      await service.removeEntityFromResource(1, 2);
      expect(repo.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM resource_entities'),
        [1, 2],
      );
    });
  });

  it('finds pending resources and handles URL and thread scoping', async () => {
    const resource = buildResource();
    const url = 'https://example.org/report';
    repo.findOne.mockResolvedValue(resource);
    repo.find.mockResolvedValue([resource]);
    const qb = repo.createQueryBuilder();
    qb.getMany.mockResolvedValue([resource]);
    await expect(service.findByUrl(url)).resolves.toBe(resource);
    await expect(service.findByUrl(url, 7)).resolves.toBe(resource);
    expect(repo.findOne).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: { url } }),
    );
    expect(repo.findOne).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: { url, project: { id: 7 } } }),
    );
    await expect(service.findByThread(4)).resolves.toEqual([resource]);
    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { thread: { id: 4 } } }),
    );
    await expect(service.findPending()).resolves.toEqual([resource]);
    expect(qb.where).toHaveBeenCalledWith('resource.projectId IS NULL');
    await expect(service.assignToThread(1, 4)).resolves.toBeNull();
    repo.findOneBy.mockResolvedValue(resource);
    repo.save.mockImplementation(async (row) => row);
    await expect(service.assignToThread(1, 4)).resolves.toMatchObject({
      thread: { id: 4 },
    });
  });

  it('lists available resources by ID and by entity references', async () => {
    const resource = buildResource();
    const qb = { ...repo.createQueryBuilder(), whereInIds: jest.fn() };
    qb.select.mockReturnValue(qb);
    qb.whereInIds.mockReturnValue(qb);
    qb.getMany.mockResolvedValue([resource]);
    repo.createQueryBuilder.mockClear().mockReturnValue(qb);
    await expect(service.findByIds([])).resolves.toEqual([]);
    expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    await expect(service.findByIds([4, 5])).resolves.toEqual([resource]);
    expect(qb.whereInIds).toHaveBeenCalledWith([4, 5]);
    await expect(service.findByEntityId(8)).resolves.toEqual([resource]);
    expect(qb.where).toHaveBeenCalledWith('entity.id = :entityId', {
      entityId: 8,
    });
    await expect(service.findByEntityName('Ada')).resolves.toEqual([resource]);
    expect(qb.where).toHaveBeenCalledWith('entity.name ILIKE :entityName', {
      entityName: '%Ada%',
    });
  });

  it('adds only new author and entity links and uses the specified keys for removal', async () => {
    const author = buildAuthor({ id: 3 });
    const entity = buildEntity({ id: 4 });
    repo.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ exists: 1 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ exists: 1 }]);
    await service.addAuthorToResource(7, author);
    await service.addAuthorToResource(7, author);
    await service.addEntityToResource(7, entity);
    await service.addEntityToResource(7, entity);
    await service.removeAuthorFromResource(7, 3);
    await service.clearResourceAuthors(7);
    await service.removeEntityFromResource(7, 4);
    const inserts = repo.query.mock.calls.filter(([sql]) =>
      sql.startsWith('INSERT'),
    );
    expect(inserts).toEqual([
      [expect.stringContaining('INSERT INTO resource_authors'), [7, 3]],
      [expect.stringContaining('INSERT INTO resource_entities'), [7, 4]],
    ]);
    const deletes = repo.query.mock.calls.filter(([sql]) =>
      sql.startsWith('DELETE'),
    );
    expect(deletes).toEqual([
      [expect.stringContaining('DELETE FROM resource_authors'), [7, 3]],
      [expect.stringContaining('DELETE FROM resource_authors'), [7]],
      [expect.stringContaining('DELETE FROM resource_entities'), [7, 4]],
    ]);
  });

  it('returns translations and queries linked entities with their types', async () => {
    const entity = buildEntity();
    repo.findOne
      .mockResolvedValueOnce({ translatedContent: 'Translated' })
      .mockResolvedValueOnce(null);
    await expect(service.getTranslatedContentById(7)).resolves.toBe(
      'Translated',
    );
    await expect(service.getTranslatedContentById(7)).resolves.toBeNull();
    const qb = repo.createQueryBuilder();
    qb.getMany.mockResolvedValue([entity]);
    const manager = repo.manager as unknown as { getRepository: jest.Mock };
    manager.getRepository.mockReturnValue(repo);
    await expect(service.getEntitiesByResourceId(7)).resolves.toEqual([entity]);
    expect(qb.where).toHaveBeenCalledWith('re.resource_id = :resourceId', {
      resourceId: 7,
    });
    expect(qb.leftJoinAndSelect).toHaveBeenCalledWith(
      'entity.entityType',
      'entityType',
    );
  });
});

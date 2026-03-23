import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HttpException, NotFoundException } from '@nestjs/common';
import { ResourceService } from '../../../src/resource/resource.service';
import { ResourceEntity } from '../../../src/resource/resource.entity';
import { FileStorageService } from '../../../src/file-storage/file-storage.service';
import { JobService } from '../../../src/job/job.service';
import { createMockRepository, MockRepository } from '../../test-utils';
import { buildResource } from '../../factories';

describe('ResourceService', () => {
  let service: ResourceService;
  let repo: MockRepository<ResourceEntity>;
  let fileStorage: Record<string, jest.Mock>;
  let jobService: Record<string, jest.Mock>;

  beforeEach(async () => {
    repo = createMockRepository<ResourceEntity>();
    fileStorage = {
      calculateHash: jest.fn(),
      storeFile: jest.fn(),
      getFile: jest.fn(),
      deleteFile: jest.fn(),
    };
    jobService = { create: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResourceService,
        { provide: getRepositoryToken(ResourceEntity), useValue: repo },
        { provide: FileStorageService, useValue: fileStorage },
        { provide: JobService, useValue: jobService },
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
    it('should confirm extraction and create detect-language job', async () => {
      const resource = buildResource({ status: 'extracted' });
      repo.findOne.mockResolvedValue(resource);
      repo.preload.mockResolvedValue(resource);
      repo.save.mockResolvedValue(resource);
      // getContentById call
      repo.findOne
        .mockResolvedValueOnce(resource) // findOne in confirmExtraction
        .mockResolvedValueOnce({ content: '<p>Hello world</p>' }); // getContentById

      jobService.create.mockResolvedValue({ id: 1 });

      const result = await service.confirmExtraction(1);
      expect(result.success).toBe(true);
      expect(jobService.create).toHaveBeenCalledWith(
        'detect-language',
        expect.any(String),
        expect.objectContaining({ resourceId: 1 }),
      );
    });

    it('should throw NotFoundException if resource not found', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.confirmExtraction(999)).rejects.toThrow(NotFoundException);
    });

    it('should throw if resource is not in extracted state', async () => {
      repo.findOne.mockResolvedValue(buildResource({ status: 'extracting' }));
      await expect(service.confirmExtraction(1)).rejects.toThrow(HttpException);
    });
  });

  describe('uploadAndProcess', () => {
    const mockFile = {
      buffer: Buffer.from('test'),
      originalname: 'test.pdf',
      mimetype: 'application/pdf',
      size: 4,
    } as Express.Multer.File;

    it('should upload, create resource, and create extraction job', async () => {
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
      jobService.create.mockResolvedValue({ id: 1 });

      const result = await service.uploadAndProcess(mockFile, {});
      expect(result).toEqual({ success: true });
      expect(jobService.create).toHaveBeenCalledWith(
        'document-extraction',
        expect.any(String),
        expect.objectContaining({ resourceId: 5 }),
      );
    });

    it('should throw AlreadyExistException if hash already exists', async () => {
      fileStorage.calculateHash.mockReturnValue('hash123');
      repo.findOne.mockResolvedValue(buildResource()); // findByHash returns existing
      await expect(service.uploadAndProcess(mockFile, {})).rejects.toThrow('File with the same content already exists');
    });

    it('should not create extraction job for images', async () => {
      const imageFile = { ...mockFile, mimetype: 'image/png' } as Express.Multer.File;
      fileStorage.calculateHash.mockReturnValue('hash456');
      repo.findOne.mockResolvedValue(null);
      fileStorage.storeFile.mockResolvedValue({ hash: 'hash456', relativePath: 'x', extension: '.png' });
      repo.create.mockReturnValue(buildResource());
      repo.save.mockResolvedValue(buildResource());

      await service.uploadAndProcess(imageFile, {});
      expect(jobService.create).not.toHaveBeenCalled();
    });
  });

  describe('getFileBuffer', () => {
    it('should return buffer and resource', async () => {
      const resource = buildResource({ path: 'some/path.pdf', mimeType: 'application/pdf' });
      repo.findOne.mockResolvedValue(resource);
      const buf = Buffer.from('content');
      fileStorage.getFile.mockResolvedValue(buf);

      const result = await service.getFileBuffer(1);
      expect(result.buffer).toEqual(buf);
      expect(result.resource).toEqual(resource);
    });

    it('should throw NotFoundException if no resource', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.getFileBuffer(999)).rejects.toThrow(NotFoundException);
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

    it('clearResourceEntities should delete all', async () => {
      repo.query.mockResolvedValue(undefined);
      await service.clearResourceEntities(1);
      expect(repo.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM resource_entities'),
        [1],
      );
    });
  });
});

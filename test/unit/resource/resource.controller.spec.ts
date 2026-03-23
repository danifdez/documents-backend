import { Test, TestingModule } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { ResourceController } from '../../../src/resource/resource.controller';
import { ResourceService } from '../../../src/resource/resource.service';
import { AuthorService } from '../../../src/author/author.service';
import { buildResource, buildAuthor } from '../../factories';

describe('ResourceController', () => {
  let controller: ResourceController;
  let resourceService: Record<string, jest.Mock>;
  let authorService: Record<string, jest.Mock>;

  beforeEach(async () => {
    resourceService = {
      findAllWithProjects: jest.fn(),
      findPending: jest.fn(),
      findOne: jest.fn(),
      findByProject: jest.fn(),
      findByEntityId: jest.fn(),
      findByEntityName: jest.fn(),
      assignToProject: jest.fn(),
      update: jest.fn(),
      confirmExtraction: jest.fn(),
      removeWithFile: jest.fn(),
      removeEntityFromResource: jest.fn(),
      addAuthorToResource: jest.fn(),
      removeAuthorFromResource: jest.fn(),
      clearResourceAuthors: jest.fn(),
      uploadAndProcess: jest.fn(),
      getFileBuffer: jest.fn(),
      resourceExists: jest.fn(),
      getContentById: jest.fn(),
      getTranslatedContentById: jest.fn(),
      getEntitiesByResourceId: jest.fn(),
    };
    authorService = { findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ResourceController],
      providers: [
        { provide: ResourceService, useValue: resourceService },
        { provide: AuthorService, useValue: authorService },
      ],
    }).compile();

    controller = module.get(ResourceController);
  });

  describe('findAll', () => {
    it('should delegate to resourceService.findAllWithProjects', async () => {
      const resources = [buildResource()];
      resourceService.findAllWithProjects.mockResolvedValue(resources);
      expect(await controller.findAll()).toEqual(resources);
    });
  });

  describe('findOne', () => {
    it('should delegate to resourceService.findOne', async () => {
      const resource = buildResource();
      resourceService.findOne.mockResolvedValue(resource);
      expect(await controller.findOne(1)).toEqual(resource);
    });
  });

  describe('assignToProject', () => {
    it('should return assigned resource', async () => {
      const resource = buildResource();
      resourceService.assignToProject.mockResolvedValue(resource);
      expect(await controller.assignToProject(1, 1)).toEqual(resource);
    });

    it('should throw NOT_FOUND if resource not found', async () => {
      resourceService.assignToProject.mockResolvedValue(null);
      await expect(controller.assignToProject(1, 1)).rejects.toThrow(HttpException);
    });
  });

  describe('confirmResource', () => {
    it('should delegate to resourceService.confirmExtraction', async () => {
      const result = { success: true, message: 'done' };
      resourceService.confirmExtraction.mockResolvedValue(result);
      expect(await controller.confirmResource(1)).toEqual(result);
    });
  });

  describe('remove', () => {
    it('should delegate to resourceService.removeWithFile', async () => {
      resourceService.removeWithFile.mockResolvedValue(undefined);
      await controller.remove(1);
      expect(resourceService.removeWithFile).toHaveBeenCalledWith(1);
    });
  });

  describe('uploadFile', () => {
    it('should throw BAD_REQUEST if no file', async () => {
      await expect(controller.uploadFile(null as any, {})).rejects.toThrow(HttpException);
    });

    it('should delegate to resourceService.uploadAndProcess', async () => {
      const file = { buffer: Buffer.from('test'), originalname: 'test.pdf', mimetype: 'application/pdf', size: 4 } as Express.Multer.File;
      resourceService.uploadAndProcess.mockResolvedValue({ success: true });
      const result = await controller.uploadFile(file, {});
      expect(result).toEqual({ success: true });
    });
  });

  describe('addAuthorToResource', () => {
    it('should add author if found', async () => {
      const author = buildAuthor();
      authorService.findOne.mockResolvedValue(author);
      resourceService.addAuthorToResource.mockResolvedValue(undefined);
      await controller.addAuthorToResource(1, 1);
      expect(resourceService.addAuthorToResource).toHaveBeenCalledWith(1, author);
    });

    it('should throw NOT_FOUND if author not found', async () => {
      authorService.findOne.mockResolvedValue(null);
      await expect(controller.addAuthorToResource(1, 999)).rejects.toThrow(HttpException);
    });
  });

  describe('getContent', () => {
    it('should return content if resource exists', async () => {
      resourceService.resourceExists.mockResolvedValue(true);
      resourceService.getContentById.mockResolvedValue('<p>Hello</p>');
      const result = await controller.getContent(1);
      expect(result).toEqual({ content: '<p>Hello</p>' });
    });

    it('should throw NOT_FOUND if resource does not exist', async () => {
      resourceService.resourceExists.mockResolvedValue(false);
      await expect(controller.getContent(999)).rejects.toThrow(HttpException);
    });
  });
});

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
      findByThread: jest.fn(),
      findByUrl: jest.fn(),
      findByEntityId: jest.fn(),
      findByEntityName: jest.fn(),
      assignToProject: jest.fn(),
      assignToThread: jest.fn(),
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
      await expect(controller.assignToProject(1, 1)).rejects.toThrow(
        HttpException,
      );
    });
  });

  describe('confirmResource', () => {
    it('should delegate to resourceService.confirmExtraction', async () => {
      const result = { success: true, message: 'done' };
      resourceService.confirmExtraction.mockResolvedValue(result);
      expect(await controller.confirmResource(1, { userId: 7 })).toEqual(
        result,
      );
      expect(resourceService.confirmExtraction).toHaveBeenCalledWith(1, {
        ownerPrincipal: '7',
      });
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
      await expect(
        controller.uploadFile(null as any, {}, { userId: 7 }),
      ).rejects.toThrow(HttpException);
    });

    it('should use the canonical standalone owner when authentication is disabled', async () => {
      const file = {
        buffer: Buffer.from('test'),
        originalname: 'test.txt',
        mimetype: 'text/plain',
        size: 4,
      } as Express.Multer.File;
      resourceService.uploadAndProcess.mockResolvedValue({
        success: true,
        resourceId: 5,
        executionId: 'execution-id',
      });
      await controller.uploadFile(file, {}, undefined);
      expect(resourceService.uploadAndProcess).toHaveBeenCalledWith(
        { ownerPrincipal: 'standalone' },
        file,
        {},
      );
    });

    it('should delegate to resourceService.uploadAndProcess', async () => {
      const file = {
        buffer: Buffer.from('test'),
        originalname: 'test.pdf',
        mimetype: 'application/pdf',
        size: 4,
      } as Express.Multer.File;
      resourceService.uploadAndProcess.mockResolvedValue({
        success: true,
        resourceId: 5,
        executionId: 'execution-id',
      });
      const result = await controller.uploadFile(file, {}, { userId: 7 });
      expect(result).toEqual({
        success: true,
        resourceId: 5,
        executionId: 'execution-id',
      });
      expect(resourceService.uploadAndProcess).toHaveBeenCalledWith(
        { ownerPrincipal: '7' },
        file,
        {},
      );
    });
  });

  describe('addAuthorToResource', () => {
    it('should add author if found', async () => {
      const author = buildAuthor();
      authorService.findOne.mockResolvedValue(author);
      resourceService.addAuthorToResource.mockResolvedValue(undefined);
      await controller.addAuthorToResource(1, 1);
      expect(resourceService.addAuthorToResource).toHaveBeenCalledWith(
        1,
        author,
      );
    });

    it('should throw NOT_FOUND if author not found', async () => {
      authorService.findOne.mockResolvedValue(null);
      await expect(controller.addAuthorToResource(1, 999)).rejects.toThrow(
        HttpException,
      );
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

  it('queries resources by URL, thread, project and linked entity', async () => {
    const resource = buildResource();
    resourceService.findByUrl.mockResolvedValue(resource);
    for (const method of [
      'findPending',
      'findByProject',
      'findByThread',
      'findByEntityId',
      'findByEntityName',
    ]) {
      resourceService[method].mockResolvedValue([resource]);
    }
    await expect(controller.getByUrl('')).resolves.toBeNull();
    const url = 'https://example.org/report';
    await expect(controller.getByUrl(url)).resolves.toEqual(resource);
    await expect(controller.getByUrl(url, '3')).resolves.toEqual(resource);
    expect(resourceService.findByUrl.mock.calls).toEqual([
      [url, undefined],
      [url, 3],
    ]);
    await expect(controller.getPending()).resolves.toEqual([resource]);
    await expect(controller.getByProject(3)).resolves.toEqual([resource]);
    await expect(controller.getByThread(4)).resolves.toEqual([resource]);
    await expect(controller.getByEntityId(5)).resolves.toEqual([resource]);
    await expect(controller.getByEntityName('Ada')).resolves.toEqual([
      resource,
    ]);
    expect(resourceService.findByProject).toHaveBeenCalledWith(3);
    expect(resourceService.findByThread).toHaveBeenCalledWith(4);
    expect(resourceService.findByEntityId).toHaveBeenCalledWith(5);
    expect(resourceService.findByEntityName).toHaveBeenCalledWith('Ada');
  });

  it('updates assignments and removes resource links with their route IDs', async () => {
    const resource = buildResource();
    resourceService.assignToThread
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(resource);
    await expect(controller.assignToThread(1, 4)).rejects.toMatchObject({
      status: 404,
    });
    await expect(controller.assignToThread(1, 4)).resolves.toEqual(resource);
    await controller.update(1, { title: 'Updated' });
    await controller.removeEntityFromResource(1, 5);
    await controller.removeAuthorFromResource(1, 6);
    await controller.clearResourceAuthors(1);
    expect(resourceService.assignToThread).toHaveBeenCalledWith(1, 4);
    expect(resourceService.update).toHaveBeenCalledWith(1, {
      title: 'Updated',
    });
    expect(resourceService.removeEntityFromResource).toHaveBeenCalledWith(1, 5);
    expect(resourceService.removeAuthorFromResource).toHaveBeenCalledWith(1, 6);
    expect(resourceService.clearResourceAuthors).toHaveBeenCalledWith(1);
    const withoutAuthors = new ResourceController(resourceService as any);
    await expect(withoutAuthors.addAuthorToResource(1, 6)).rejects.toThrow(
      'Authors feature is disabled',
    );
  });

  it('serializes missing content and unavailable related data', async () => {
    resourceService.resourceExists
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    resourceService.getTranslatedContentById
      .mockResolvedValueOnce(null)
      .mockResolvedValue('Translated');
    resourceService.getEntitiesByResourceId.mockResolvedValue([{ id: 5 }]);
    await expect(controller.getContent(1)).resolves.toEqual({ content: null });
    await expect(controller.getEntities(1)).rejects.toMatchObject({
      status: 404,
    });
    await expect(controller.getEntities(1)).resolves.toEqual([{ id: 5 }]);
    await expect(controller.getTranslatedContent(1)).rejects.toMatchObject({
      status: 404,
    });
    await expect(controller.getTranslatedContent(1)).resolves.toEqual({
      translatedContent: 'Translated',
    });
  });

  it('sends downloads with a portable filename and its UTF-8 form', async () => {
    const buffer = Buffer.from('document');
    resourceService.getFileBuffer.mockResolvedValue({
      buffer,
      resource: { originalName: 'résumé final.txt', mimeType: 'text/plain' },
    });
    const res = { setHeader: jest.fn(), send: jest.fn() };
    await controller.downloadFile(1, res as any);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="r_sum__final.txt"; filename*=UTF-8\'\'r%C3%A9sum%C3%A9%20final.txt',
    );
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/plain');
    expect(res.send).toHaveBeenCalledWith(buffer);
  });

  it.each([
    [undefined, 200, undefined, '0123456789'],
    ['bytes=2-4', 206, 'bytes 2-4/10', '234'],
    ['bytes=3-', 206, 'bytes 3-9/10', '3456789'],
  ])(
    'serves the requested byte range %s',
    async (range, status, contentRange, expected) => {
      resourceService.getFileBuffer.mockResolvedValue({
        buffer: Buffer.from('0123456789'),
        resource: { mimeType: 'text/plain' },
      });
      const res = { setHeader: jest.fn(), send: jest.fn(), status: jest.fn() };
      await controller.viewFile(1, { headers: { range } } as any, res as any);
      expect(res.setHeader).toHaveBeenCalledWith('Accept-Ranges', 'bytes');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Length',
        expected.length,
      );
      expect(res.send).toHaveBeenCalledWith(Buffer.from(expected));
      if (status === 206) {
        expect(res.status).toHaveBeenCalledWith(206);
        expect(res.setHeader).toHaveBeenCalledWith(
          'Content-Range',
          contentRange,
        );
      } else {
        expect(res.status).not.toHaveBeenCalled();
      }
    },
  );
});

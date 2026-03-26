import { Test, TestingModule } from '@nestjs/testing';
import { ProjectController } from '../../../src/project/project.controller';
import { ProjectService } from '../../../src/project/project.service';
import { buildProject } from '../../factories';

describe('ProjectController', () => {
  let controller: ProjectController;
  let projectService: Record<string, jest.Mock>;

  beforeEach(async () => {
    projectService = {
      findAll: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      search: jest.fn(),
      getStats: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProjectController],
      providers: [{ provide: ProjectService, useValue: projectService }],
    }).compile();

    controller = module.get(ProjectController);
  });

  describe('getAll', () => {
    it('should return all projects', async () => {
      const projects = [buildProject(), buildProject({ id: 2, name: 'Second' })];
      projectService.findAll.mockResolvedValue(projects);
      expect(await controller.getAll()).toEqual(projects);
      expect(projectService.findAll).toHaveBeenCalled();
    });

    it('should return empty array when no projects', async () => {
      projectService.findAll.mockResolvedValue([]);
      expect(await controller.getAll()).toEqual([]);
    });
  });

  describe('findOne', () => {
    it('should delegate to projectService.findOne', async () => {
      const project = buildProject();
      projectService.findOne.mockResolvedValue(project);
      expect(await controller.findOne(1)).toEqual(project);
      expect(projectService.findOne).toHaveBeenCalledWith(1);
    });

    it('should return null when not found', async () => {
      projectService.findOne.mockResolvedValue(null);
      expect(await controller.findOne(999)).toBeNull();
    });
  });

  describe('create', () => {
    it('should delegate to projectService.create', async () => {
      const project = buildProject({ name: 'New Project' });
      projectService.create.mockResolvedValue(project);
      expect(await controller.create({ name: 'New Project' })).toEqual(project);
      expect(projectService.create).toHaveBeenCalledWith({ name: 'New Project' });
    });
  });

  describe('update', () => {
    it('should delegate to projectService.update', async () => {
      const project = buildProject({ name: 'Updated' });
      projectService.update.mockResolvedValue(project);
      expect(await controller.update(1, { name: 'Updated' })).toEqual(project);
      expect(projectService.update).toHaveBeenCalledWith(1, { name: 'Updated' });
    });

    it('should return null when project not found', async () => {
      projectService.update.mockResolvedValue(null);
      expect(await controller.update(999, { name: 'X' })).toBeNull();
    });
  });

  describe('remove', () => {
    it('should delegate to projectService.remove', async () => {
      projectService.remove.mockResolvedValue(undefined);
      await controller.remove(1);
      expect(projectService.remove).toHaveBeenCalledWith(1);
    });
  });

  describe('search', () => {
    it('should delegate to projectService.search', async () => {
      const projects = [buildProject()];
      projectService.search.mockResolvedValue(projects);
      expect(await controller.search('test')).toEqual(projects);
      expect(projectService.search).toHaveBeenCalledWith('test');
    });
  });

  describe('getStats', () => {
    it('should delegate to projectService.getStats', async () => {
      const stats = { resourceCount: '5', docCount: '3' };
      projectService.getStats.mockResolvedValue(stats);
      expect(await controller.getStats(1)).toEqual(stats);
      expect(projectService.getStats).toHaveBeenCalledWith(1);
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { ProjectController } from '../src/project/project.controller';
import { ProjectService } from '../src/project/project.service';
import { buildProject } from './factories';
import { APP_GUARD } from '@nestjs/core';

/**
 * E2E tests for /projects endpoints.
 *
 * These tests spin up a lightweight NestJS application with the real
 * controller and pipes but a mock service, so they exercise the full
 * HTTP stack (routing, param parsing, validation, serialization)
 * without requiring a database.
 */
describe('ProjectController (e2e)', () => {
  let app: INestApplication;
  let projectService: Record<string, jest.Mock>;

  beforeAll(async () => {
    projectService = {
      findAll: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      search: jest.fn(),
      getStats: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ProjectController],
      providers: [
        { provide: ProjectService, useValue: projectService },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── GET /projects ────────────────────────────────────────

  describe('GET /projects', () => {
    it('should return 200 with all projects', async () => {
      const projects = [buildProject(), buildProject({ id: 2, name: 'Second' })];
      projectService.findAll.mockResolvedValue(projects);

      const res = await request(app.getHttpServer()).get('/projects');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].name).toBe('Test Project');
    });

    it('should return empty array when no projects', async () => {
      projectService.findAll.mockResolvedValue([]);
      const res = await request(app.getHttpServer()).get('/projects');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  // ── GET /projects/search ─────────────────────────────────

  describe('GET /projects/search', () => {
    it('should search with query parameter', async () => {
      projectService.search.mockResolvedValue([buildProject({ name: 'Matching' })]);
      const res = await request(app.getHttpServer())
        .get('/projects/search')
        .query({ q: 'Matching' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(projectService.search).toHaveBeenCalledWith('Matching');
    });

    it('should handle missing query parameter', async () => {
      projectService.search.mockResolvedValue([]);
      const res = await request(app.getHttpServer()).get('/projects/search');
      expect(res.status).toBe(200);
    });
  });

  // ── GET /projects/:id ────────────────────────────────────

  describe('GET /projects/:id', () => {
    it('should return 200 with a project', async () => {
      const project = buildProject();
      projectService.findOne.mockResolvedValue(project);

      const res = await request(app.getHttpServer()).get('/projects/1');
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Test Project');
      expect(projectService.findOne).toHaveBeenCalledWith(1);
    });

    it('should return 200 with null when not found', async () => {
      projectService.findOne.mockResolvedValue(null);
      const res = await request(app.getHttpServer()).get('/projects/999');
      expect(res.status).toBe(200);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app.getHttpServer()).get('/projects/abc');
      expect(res.status).toBe(400);
    });
  });

  // ── GET /projects/:id/stats ──────────────────────────────

  describe('GET /projects/:id/stats', () => {
    it('should return 200 with stats', async () => {
      const stats = {
        resourceCount: '5',
        docCount: '3',
        languages: ['en'],
        topKeywords: [],
        topEntities: [],
        topAuthors: [],
      };
      projectService.getStats.mockResolvedValue(stats);

      const res = await request(app.getHttpServer()).get('/projects/1/stats');
      expect(res.status).toBe(200);
      expect(res.body.resourceCount).toBe('5');
      expect(projectService.getStats).toHaveBeenCalledWith(1);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app.getHttpServer()).get('/projects/abc/stats');
      expect(res.status).toBe(400);
    });
  });

  // ── POST /projects ───────────────────────────────────────

  describe('POST /projects', () => {
    it('should create a project and return 201', async () => {
      const project = buildProject({ name: 'New Project' });
      projectService.create.mockResolvedValue(project);

      const res = await request(app.getHttpServer())
        .post('/projects')
        .send({ name: 'New Project' });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('New Project');
      expect(projectService.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'New Project' }),
      );
    });

    it('should accept project with description', async () => {
      const project = buildProject({ name: 'P', description: 'Desc' });
      projectService.create.mockResolvedValue(project);

      const res = await request(app.getHttpServer())
        .post('/projects')
        .send({ name: 'P', description: 'Desc' });

      expect(res.status).toBe(201);
    });
  });

  // ── PATCH /projects/:id ──────────────────────────────────

  describe('PATCH /projects/:id', () => {
    it('should update a project', async () => {
      const project = buildProject({ name: 'Updated' });
      projectService.update.mockResolvedValue(project);

      const res = await request(app.getHttpServer())
        .patch('/projects/1')
        .send({ name: 'Updated' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated');
      expect(projectService.update).toHaveBeenCalledWith(1, expect.objectContaining({ name: 'Updated' }));
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app.getHttpServer())
        .patch('/projects/abc')
        .send({ name: 'X' });
      expect(res.status).toBe(400);
    });
  });

  // ── DELETE /projects/:id ─────────────────────────────────

  describe('DELETE /projects/:id', () => {
    it('should delete a project and return 200', async () => {
      projectService.remove.mockResolvedValue(undefined);
      const res = await request(app.getHttpServer()).delete('/projects/1');
      expect(res.status).toBe(200);
      expect(projectService.remove).toHaveBeenCalledWith(1);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app.getHttpServer()).delete('/projects/abc');
      expect(res.status).toBe(400);
    });
  });
});

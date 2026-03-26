import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { BibliographyController } from '../src/bibliography/bibliography.controller';
import { BibliographyService } from '../src/bibliography/bibliography.service';
import { buildBibliographyEntry } from './factories';

/**
 * E2E tests for /bibliography endpoints.
 */
describe('BibliographyController (e2e)', () => {
  let app: INestApplication;
  let bibService: Record<string, jest.Mock>;

  beforeAll(async () => {
    bibService = {
      findAll: jest.fn(),
      findGlobal: jest.fn(),
      findByProject: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      importFromResource: jest.fn(),
      importBibTeX: jest.fn(),
      exportBibTeX: jest.fn(),
      assignProject: jest.fn(),
      makeGlobal: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [BibliographyController],
      providers: [{ provide: BibliographyService, useValue: bibService }],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  // ── GET /bibliography ─────────────────────────────────────

  describe('GET /bibliography', () => {
    it('should return all entries', async () => {
      const entries = [buildBibliographyEntry()];
      bibService.findAll.mockResolvedValue(entries);
      const res = await request(app.getHttpServer()).get('/bibliography');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });
  });

  // ── GET /bibliography/global ──────────────────────────────

  describe('GET /bibliography/global', () => {
    it('should return global entries', async () => {
      bibService.findGlobal.mockResolvedValue([]);
      const res = await request(app.getHttpServer()).get('/bibliography/global');
      expect(res.status).toBe(200);
      expect(bibService.findGlobal).toHaveBeenCalled();
    });
  });

  // ── GET /bibliography/project/:projectId ──────────────────

  describe('GET /bibliography/project/:projectId', () => {
    it('should return entries for a project', async () => {
      const entries = [buildBibliographyEntry()];
      bibService.findByProject.mockResolvedValue(entries);

      const res = await request(app.getHttpServer()).get('/bibliography/project/1');
      expect(res.status).toBe(200);
      expect(bibService.findByProject).toHaveBeenCalledWith(1);
    });

    it('should return 400 for non-numeric projectId', async () => {
      const res = await request(app.getHttpServer()).get('/bibliography/project/abc');
      expect(res.status).toBe(400);
    });
  });

  // ── GET /bibliography/:id ─────────────────────────────────

  describe('GET /bibliography/:id', () => {
    it('should return a single entry', async () => {
      const entry = buildBibliographyEntry();
      bibService.findOne.mockResolvedValue(entry);
      const res = await request(app.getHttpServer()).get('/bibliography/1');
      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Test Article');
    });

    it('should return 200 with null when not found', async () => {
      bibService.findOne.mockResolvedValue(null);
      const res = await request(app.getHttpServer()).get('/bibliography/999');
      expect(res.status).toBe(200);
    });
  });

  // ── POST /bibliography ────────────────────────────────────

  describe('POST /bibliography', () => {
    it('should create a new entry', async () => {
      const entry = buildBibliographyEntry({ title: 'New Entry' });
      bibService.create.mockResolvedValue(entry);

      const res = await request(app.getHttpServer())
        .post('/bibliography')
        .send({ title: 'New Entry', entryType: 'article', citeKey: 'new2025' });

      expect(res.status).toBe(201);
      expect(res.body.title).toBe('New Entry');
    });
  });

  // ── POST /bibliography/import/resource/:resourceId ────────

  describe('POST /bibliography/import/resource/:resourceId', () => {
    it('should import from resource', async () => {
      const entry = buildBibliographyEntry();
      bibService.importFromResource.mockResolvedValue(entry);

      const res = await request(app.getHttpServer())
        .post('/bibliography/import/resource/1')
        .send({ projectId: 5 });

      expect(res.status).toBe(201);
      expect(bibService.importFromResource).toHaveBeenCalledWith(1, 5);
    });
  });

  // ── POST /bibliography/import/bibtex ──────────────────────

  describe('POST /bibliography/import/bibtex', () => {
    it('should import BibTeX string', async () => {
      const entries = [buildBibliographyEntry()];
      bibService.importBibTeX.mockResolvedValue(entries);

      const res = await request(app.getHttpServer())
        .post('/bibliography/import/bibtex')
        .send({ bibtex: '@article{test, title={T}}', projectId: 1 });

      expect(res.status).toBe(201);
      expect(bibService.importBibTeX).toHaveBeenCalledWith(
        '@article{test, title={T}}',
        1,
      );
    });
  });

  // ── GET /bibliography/export/bibtex ───────────────────────

  describe('GET /bibliography/export/bibtex', () => {
    it('should export BibTeX with correct headers', async () => {
      bibService.exportBibTeX.mockResolvedValue('@article{doe2025, title={Test}}');

      const res = await request(app.getHttpServer())
        .get('/bibliography/export/bibtex')
        .query({ projectId: '1' });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.headers['content-disposition']).toContain('bibliography.bib');
      expect(res.text).toContain('@article{doe2025');
    });

    it('should export specific ids', async () => {
      bibService.exportBibTeX.mockResolvedValue('');
      await request(app.getHttpServer())
        .get('/bibliography/export/bibtex')
        .query({ ids: '1,2,3' });

      expect(bibService.exportBibTeX).toHaveBeenCalledWith(undefined, [1, 2, 3]);
    });
  });

  // ── PATCH /bibliography/:id ───────────────────────────────

  describe('PATCH /bibliography/:id', () => {
    it('should update an entry', async () => {
      const entry = buildBibliographyEntry({ title: 'Updated' });
      bibService.update.mockResolvedValue(entry);

      const res = await request(app.getHttpServer())
        .patch('/bibliography/1')
        .send({ title: 'Updated' });

      expect(res.status).toBe(200);
      expect(bibService.update).toHaveBeenCalledWith(1, expect.objectContaining({ title: 'Updated' }));
    });
  });

  // ── PATCH /bibliography/:id/make-global ───────────────────

  describe('PATCH /bibliography/:id/make-global', () => {
    it('should make entry global', async () => {
      const entry = buildBibliographyEntry();
      bibService.makeGlobal.mockResolvedValue(entry);

      const res = await request(app.getHttpServer()).patch('/bibliography/1/make-global');
      expect(res.status).toBe(200);
      expect(bibService.makeGlobal).toHaveBeenCalledWith(1);
    });
  });

  // ── PATCH /bibliography/:id/assign-project ────────────────

  describe('PATCH /bibliography/:id/assign-project', () => {
    it('should assign project to entry', async () => {
      const entry = buildBibliographyEntry();
      bibService.assignProject.mockResolvedValue(entry);

      const res = await request(app.getHttpServer())
        .patch('/bibliography/1/assign-project')
        .send({ projectId: 5 });

      expect(res.status).toBe(200);
      expect(bibService.assignProject).toHaveBeenCalledWith(1, 5);
    });
  });

  // ── DELETE /bibliography/:id ──────────────────────────────

  describe('DELETE /bibliography/:id', () => {
    it('should delete an entry', async () => {
      bibService.remove.mockResolvedValue({ deleted: true });
      const res = await request(app.getHttpServer()).delete('/bibliography/1');
      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(true);
    });
  });
});

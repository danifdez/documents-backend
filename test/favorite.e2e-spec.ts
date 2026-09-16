import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { FavoriteController } from '../src/favorite/favorite.controller';
import { FavoriteService } from '../src/favorite/favorite.service';
import { buildFavorite } from './factories';

/**
 * E2E tests for /favorites endpoints.
 *
 * Like the other e2e suites, this runs the real controller, routing and
 * validation against a mock service, so no database is required. What is under
 * test is the HTTP contract the browser relies on: list by project, idempotent
 * upsert, rename and delete.
 */
describe('FavoriteController (e2e)', () => {
  let app: INestApplication;
  let favoriteService: Record<string, jest.Mock>;

  beforeAll(async () => {
    favoriteService = {
      findByProject: jest.fn(),
      findOne: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      removeByUrl: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [FavoriteController],
      providers: [{ provide: FavoriteService, useValue: favoriteService }],
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

  // ── GET /favorites/project/:projectId ────────────────────

  describe('GET /favorites/project/:projectId', () => {
    it('should return 200 with the project favorites', async () => {
      favoriteService.findByProject.mockResolvedValue([
        buildFavorite(),
        buildFavorite({ id: 2, url: 'https://ejemplo.com/otra' }),
      ]);

      const res = await request(app.getHttpServer()).get(
        '/favorites/project/1',
      );

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].url).toBe('https://ejemplo.com/pagina');
      expect(favoriteService.findByProject).toHaveBeenCalledWith(1);
    });

    it('should return 400 for a non-numeric project id', async () => {
      const res = await request(app.getHttpServer()).get(
        '/favorites/project/abc',
      );
      expect(res.status).toBe(400);
    });
  });

  // ── POST /favorites ──────────────────────────────────────

  describe('POST /favorites', () => {
    it('should upsert and return 201', async () => {
      favoriteService.upsert.mockResolvedValue(buildFavorite());

      const res = await request(app.getHttpServer())
        .post('/favorites')
        .send({
          projectId: 1,
          url: 'https://ejemplo.com/pagina',
          title: 'Página de ejemplo',
        });

      expect(res.status).toBe(201);
      expect(res.body.url).toBe('https://ejemplo.com/pagina');
      expect(favoriteService.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 1, url: 'https://ejemplo.com/pagina' }),
      );
    });

    it('should reject a favorite without url', async () => {
      const res = await request(app.getHttpServer())
        .post('/favorites')
        .send({ projectId: 1 });

      expect(res.status).toBe(400);
      expect(favoriteService.upsert).not.toHaveBeenCalled();
    });

    it('should reject a favorite without project', async () => {
      const res = await request(app.getHttpServer())
        .post('/favorites')
        .send({ url: 'https://ejemplo.com/pagina' });

      expect(res.status).toBe(400);
    });
  });

  // ── PATCH /favorites/:id ─────────────────────────────────

  describe('PATCH /favorites/:id', () => {
    it('should rename a favorite', async () => {
      favoriteService.update.mockResolvedValue(
        buildFavorite({ title: 'Otro nombre' }),
      );

      const res = await request(app.getHttpServer())
        .patch('/favorites/1')
        .send({ title: 'Otro nombre' });

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Otro nombre');
      expect(favoriteService.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ title: 'Otro nombre' }),
      );
    });

    it('should return 400 for a non-numeric id', async () => {
      const res = await request(app.getHttpServer())
        .patch('/favorites/abc')
        .send({ title: 'X' });
      expect(res.status).toBe(400);
    });
  });

  // ── DELETE /favorites/:id ────────────────────────────────

  describe('DELETE /favorites/:id', () => {
    it('should delete a favorite', async () => {
      favoriteService.remove.mockResolvedValue({ deleted: true });

      const res = await request(app.getHttpServer()).delete('/favorites/1');

      expect(res.status).toBe(200);
      expect(favoriteService.remove).toHaveBeenCalledWith(1);
    });

    it('should return 400 for a non-numeric id', async () => {
      const res = await request(app.getHttpServer()).delete('/favorites/abc');
      expect(res.status).toBe(400);
    });
  });

  // ── DELETE /favorites/project/:projectId ─────────────────

  describe('DELETE /favorites/project/:projectId', () => {
    it('should remove a favorite by url', async () => {
      favoriteService.removeByUrl.mockResolvedValue({ deleted: true });

      const res = await request(app.getHttpServer())
        .delete('/favorites/project/1')
        .query({ url: 'https://ejemplo.com/pagina' });

      expect(res.status).toBe(200);
      expect(favoriteService.removeByUrl).toHaveBeenCalledWith(
        1,
        'https://ejemplo.com/pagina',
      );
    });

    it('should return 400 for a non-numeric project id', async () => {
      const res = await request(app.getHttpServer())
        .delete('/favorites/project/abc')
        .query({ url: 'https://ejemplo.com/pagina' });
      expect(res.status).toBe(400);
    });
  });
});

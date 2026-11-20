import { Logger } from '@nestjs/common';
import { MoreThan } from 'typeorm';
import { OfflineService } from '../../../src/offline/offline.service';
import { DocEntity } from '../../../src/doc/doc.entity';
import { ResourceEntity } from '../../../src/resource/resource.entity';
import { ThreadEntity } from '../../../src/thread/thread.entity';
import { CommentEntity } from '../../../src/comment/comment.entity';
import { MarkEntity } from '../../../src/mark/mark.entity';
import { ReadingPointEntity } from '../../../src/reading-point/reading-point.entity';
import { NoteEntity } from '../../../src/note/note.entity';
import { ProjectEntity } from '../../../src/project/project.entity';
import {
  createMockQueryBuilder,
  createMockRepository,
  MockRepository,
} from '../../test-utils';

describe('OfflineService applySync', () => {
  let service: OfflineService;
  let docRepo: MockRepository<DocEntity>;
  let dataSource: { transaction: jest.Mock };
  let manager: { withRepository: jest.Mock };

  beforeEach(() => {
    docRepo = createMockRepository<DocEntity>();
    manager = { withRepository: jest.fn((repo) => repo) };
    dataSource = {
      transaction: jest.fn(async (work: (m: any) => unknown) => work(manager)),
    };
    service = new OfflineService(
      createMockRepository<ResourceEntity>() as any,
      docRepo as any,
      createMockRepository<ThreadEntity>() as any,
      createMockRepository<CommentEntity>() as any,
      createMockRepository<MarkEntity>() as any,
      createMockRepository<ReadingPointEntity>() as any,
      createMockRepository<NoteEntity>() as any,
      createMockRepository<ProjectEntity>() as any,
      { getFile: jest.fn() } as any,
      { get: (_key: string, fallback: string) => fallback } as any,
      dataSource as any,
    );
  });

  const change = (overrides: Record<string, any> = {}) => ({
    entityType: 'doc',
    entityId: 1,
    method: 'PATCH',
    payload: {},
    updatedAt: new Date().toISOString(),
    ...overrides,
  });

  it('only applies update fields and protects id and relations', async () => {
    const existing = {
      id: 1,
      name: 'Old',
      content: 'Old',
      project: { id: 5 },
      updatedAt: new Date(0),
    };
    docRepo.findOneBy.mockResolvedValue(existing);
    docRepo.save.mockImplementation(async (entity: any) => entity);

    await service.applySync([
      change({
        payload: {
          id: 99,
          projectId: 999,
          threadId: 999,
          name: 'New',
          content: 'New',
        },
      }),
    ]);

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(manager.withRepository).toHaveBeenCalledWith(docRepo);
    const saved = (docRepo.save as jest.Mock).mock.calls[0][0];
    expect(saved).toMatchObject({
      id: 1,
      name: 'New',
      content: 'New',
      project: { id: 5 },
    });
    expect(saved.thread).toBeUndefined();
  });

  it('maps allowed foreign keys to relations on create but drops the id', async () => {
    docRepo.create.mockImplementation((data: any) => data);
    docRepo.save.mockResolvedValue({ id: 10, name: 'Doc' });

    await service.applySync([
      change({
        entityId: 0,
        method: 'POST',
        payload: {
          id: 99,
          name: 'Doc',
          content: 'Body',
          projectId: 5,
          threadId: 6,
          resourceId: 7,
        },
      }),
    ]);

    expect(docRepo.create).toHaveBeenCalledWith({
      name: 'Doc',
      content: 'Body',
      project: { id: 5 },
      thread: { id: 6 },
      resource: { id: 7 },
    });
  });

  it('reports an error for unknown entity types without writing', async () => {
    const result = await service.applySync([
      change({ entityType: 'unknown' as any }),
    ]);

    expect(result.results[0].status).toBe('error');
    expect(docRepo.save).not.toHaveBeenCalled();
  });

  it('reports stale, missing and deleted records independently in a batch', async () => {
    const current = {
      id: 1,
      name: 'Server edit',
      updatedAt: '2026-01-02T00:00:00Z',
    };
    docRepo.findOneBy
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(null);
    docRepo.delete
      .mockResolvedValueOnce({ affected: 1 })
      .mockRejectedValueOnce(new Error('delete failed'));

    await expect(
      service.applySync([
        change({ updatedAt: '2026-01-01T00:00:00Z', payload: { name: 'Old' } }),
        change({ entityId: 2 }),
        change({ method: 'DELETE', entityId: 3 }),
        change({ method: 'DELETE', entityId: 4 }),
        change({ method: 'PUT', entityId: 5 }),
      ]),
    ).resolves.toEqual({
      results: [
        {
          entityType: 'doc',
          entityId: 1,
          status: 'conflict',
          serverData: current,
        },
        { entityType: 'doc', entityId: 2, status: 'error' },
        { entityType: 'doc', entityId: 3, status: 'applied' },
        { entityType: 'doc', entityId: 4, status: 'error' },
        { entityType: 'doc', entityId: 5, status: 'error' },
      ],
    });
    expect(docRepo.save).not.toHaveBeenCalled();
    expect(docRepo.delete.mock.calls).toEqual([[3], [4]]);
  });
});

describe('OfflineService bundles and deltas', () => {
  function repo() {
    const qb = { ...createMockQueryBuilder(), whereInIds: jest.fn() };
    qb.where.mockReturnValue(qb);
    qb.andWhere.mockReturnValue(qb);
    qb.leftJoinAndSelect.mockReturnValue(qb);
    qb.whereInIds.mockReturnValue(qb);
    return {
      ...createMockRepository(),
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      qb,
    };
  }
  const limit = 1024 * 1024;
  const project = { id: 1 };
  const doc = { id: 3, resource: { id: 6 } };
  const thread = { id: 5, project };
  const small = {
    id: 6,
    project,
    path: 'file',
    fileSize: limit,
    mimeType: 'text/plain',
  };
  const large = {
    id: 7,
    path: 'large',
    fileSize: limit + 1,
    name: 'Stored',
    originalName: 'Original',
  };
  const missing = {
    id: 8,
    name: 'Missing local file',
    path: 'missing',
    fileSize: 23,
  };
  const web = { id: 9, name: 'Website' };
  const excluded = {
    resourceId: 7,
    name: 'Original',
    fileSize: limit + 1,
    reason: 'File exceeds 1MB limit',
  };
  const file = {
    resourceId: 6,
    mimeType: 'text/plain',
    base64: Buffer.from('document').toString('base64'),
  };
  let resources: ReturnType<typeof repo>;
  let docs: ReturnType<typeof repo>;
  let threads: ReturnType<typeof repo>;
  let comments: ReturnType<typeof repo>;
  let marks: ReturnType<typeof repo>;
  let points: ReturnType<typeof repo>;
  let notes: ReturnType<typeof repo>;
  let projects: ReturnType<typeof repo>;
  let getFile: jest.Mock;
  let service: OfflineService;

  function createService(withNotes = true) {
    return new OfflineService(
      resources as any,
      docs as any,
      threads as any,
      comments as any,
      marks as any,
      points as any,
      withNotes ? (notes as any) : null,
      projects as any,
      { getFile } as any,
      { get: () => String(limit) } as any,
      {} as any,
    );
  }

  beforeEach(() => {
    resources = repo();
    docs = repo();
    threads = repo();
    comments = repo();
    marks = repo();
    points = repo();
    notes = repo();
    projects = repo();
    for (const repository of [
      resources,
      docs,
      threads,
      comments,
      marks,
      points,
      notes,
    ]) {
      repository.find.mockResolvedValue([]);
    }
    getFile = jest.fn((path) =>
      path === 'missing'
        ? Promise.reject(new Error('file not found'))
        : Promise.resolve(Buffer.from('document')),
    );
    service = createService();
  });

  afterEach(() => jest.restoreAllMocks());

  it('returns no bundles for unknown resource, thread or project ids', async () => {
    await expect(service.bundleResource(99)).resolves.toBeNull();
    await expect(service.bundleThread(99)).resolves.toBeNull();
    await expect(service.bundleProject(99)).resolves.toBeNull();
    expect(getFile).not.toHaveBeenCalled();
  });

  it('bundles a resource with the relevant annotations and includes files at the limit', async () => {
    resources.findOne.mockResolvedValue(small);
    comments.find.mockResolvedValue([{ id: 10 }]);
    marks.find.mockResolvedValue([{ id: 11 }]);
    points.find.mockResolvedValue([{ id: 12 }]);
    await expect(service.bundleResource(6)).resolves.toEqual({
      project,
      resources: [small],
      docs: [],
      threads: [],
      notes: [],
      comments: [{ id: 10 }],
      marks: [{ id: 11 }],
      readingPoints: [{ id: 12 }],
      files: [file],
      excludedFiles: [],
    });
    for (const repository of [comments, marks, points]) {
      expect(repository.find).toHaveBeenCalledWith({
        where: { resource: { id: 6 } },
      });
    }
  });

  it('omits oversized, unavailable and non-file resources from the payload', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    resources.findOne
      .mockResolvedValueOnce(large)
      .mockResolvedValueOnce(missing)
      .mockResolvedValueOnce(web);
    await expect(service.bundleResource(7)).resolves.toMatchObject({
      files: [],
      excludedFiles: [excluded],
    });
    await expect(service.bundleResource(8)).resolves.toMatchObject({
      files: [],
      excludedFiles: [],
    });
    await expect(service.bundleResource(9)).resolves.toMatchObject({
      project: null,
      files: [],
      excludedFiles: [],
    });
    expect(getFile.mock.calls).toEqual([['missing']]);
    expect(warn).toHaveBeenCalledWith(
      'Could not read file for resource 8: file not found',
    );
  });

  it('returns only documents and resources connected to the requested thread', async () => {
    threads.findOne.mockResolvedValue(thread);
    docs.find.mockResolvedValue([doc, { id: 4 }]);
    comments.qb.getMany.mockResolvedValue([{ id: 10 }]);
    marks.qb.getMany.mockResolvedValue([{ id: 11 }]);
    points.qb.getMany.mockResolvedValue([{ id: 12 }]);
    resources.qb.getMany.mockResolvedValue([small]);

    await expect(service.bundleThread(5)).resolves.toEqual({
      project,
      threads: [thread],
      docs: [doc, { id: 4 }],
      resources: [small],
      notes: [],
      comments: [{ id: 10 }],
      marks: [{ id: 11 }],
      readingPoints: [{ id: 12 }],
      files: [file],
      excludedFiles: [],
    });
    expect(docs.find).toHaveBeenCalledWith({
      where: { thread: { id: 5 } },
      relations: ['resource', 'project'],
    });
    expect(resources.qb.whereInIds).toHaveBeenCalledWith([6]);
    expect(comments.qb.where).toHaveBeenCalledWith('c.docId IN (:...ids)', {
      ids: [3, 4],
    });
  });

  it('combines project notes and annotations from both documents and resources', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    projects.findOneBy.mockResolvedValue(project);
    threads.find.mockResolvedValue([thread]);
    docs.find.mockResolvedValue([doc]);
    notes.find.mockResolvedValue([{ id: 14 }]);
    resources.find.mockResolvedValue([small, large, missing, web]);
    comments.qb.getMany
      .mockResolvedValueOnce([{ id: 10 }])
      .mockResolvedValueOnce([{ id: 11 }]);
    marks.qb.getMany
      .mockResolvedValueOnce([{ id: 20 }])
      .mockResolvedValueOnce([{ id: 21 }]);
    points.qb.getMany
      .mockResolvedValueOnce([{ id: 30 }])
      .mockResolvedValueOnce([{ id: 31 }]);

    await expect(service.bundleProject(1)).resolves.toEqual({
      project,
      threads: [thread],
      docs: [doc],
      resources: [small, large, missing, web],
      notes: [{ id: 14 }],
      comments: [{ id: 10 }, { id: 11 }],
      marks: [{ id: 20 }, { id: 21 }],
      readingPoints: [{ id: 30 }, { id: 31 }],
      files: [file],
      excludedFiles: [excluded],
    });
    expect(getFile.mock.calls).toEqual([['file'], ['missing']]);
    expect(warn).toHaveBeenCalledWith(
      'Could not read file for resource 8: file not found',
    );
    expect(points.qb.where.mock.calls).toEqual([
      ['rp.docId IN (:...ids)', { ids: [3] }],
      ['rp.resourceId IN (:...ids)', { ids: [6, 7, 8, 9] }],
    ]);
  });

  it('handles empty bundles and a disabled note module without querying annotations', async () => {
    projects.findOneBy.mockResolvedValue(project);
    threads.findOne.mockResolvedValue({ id: 5 });
    service = createService(false);
    for (const bundle of [
      await service.bundleProject(1),
      await service.bundleThread(5),
    ]) {
      expect(bundle).toMatchObject({
        docs: [],
        resources: [],
        notes: [],
        comments: [],
        marks: [],
        readingPoints: [],
        files: [],
        excludedFiles: [],
      });
    }
    await expect(
      service.getChangesSince('2026-01-01', 1),
    ).resolves.toMatchObject({ notes: [] });
    expect(notes.find).not.toHaveBeenCalled();
    for (const repository of [comments, marks, points]) {
      expect(repository.createQueryBuilder).not.toHaveBeenCalled();
    }
  });

  it('filters changed records and annotations using the same timestamp and project', async () => {
    const since = '2026-01-01T12:00:00.000Z';
    const timestamp = new Date(since);
    docs.find.mockResolvedValue([doc]);
    resources.find.mockResolvedValue([small]);
    threads.find.mockResolvedValue([thread]);
    notes.find.mockResolvedValue([{ id: 14 }]);
    comments.qb.getMany
      .mockResolvedValueOnce([{ id: 10 }])
      .mockResolvedValueOnce([{ id: 11 }]);
    await expect(service.getChangesSince(since, 1)).resolves.toEqual({
      docs: [doc],
      resources: [small],
      threads: [thread],
      notes: [{ id: 14 }],
      comments: [{ id: 10 }, { id: 11 }],
      marks: [],
      readingPoints: [],
    });
    for (const repository of [docs, resources, threads, notes]) {
      expect(repository.find).toHaveBeenCalledWith({
        where: { project: { id: 1 }, updatedAt: MoreThan(timestamp) },
      });
    }
    expect(comments.qb.where.mock.calls).toEqual([
      ['c.docId IN (:...ids)', { ids: [3] }],
      ['c.resourceId IN (:...ids)', { ids: [6] }],
    ]);
    expect(comments.qb.andWhere.mock.calls).toEqual(
      Array(2).fill(['c.updatedAt > :since', { since: timestamp }]),
    );
  });

  it('rejects invalid delta cursors and project identifiers', async () => {
    await expect(service.getChangesSince('invalid', 1)).rejects.toThrow(
      'Invalid since date',
    );
    await expect(service.getChangesSince('2026-01-01', 0)).rejects.toThrow(
      'Invalid projectId',
    );
    await expect(service.getChangesSince('2026-01-01', 1.5)).rejects.toThrow(
      'Invalid projectId',
    );
    expect(resources.find).not.toHaveBeenCalled();
  });
});

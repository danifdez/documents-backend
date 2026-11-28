import { Logger, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In, IsNull, Not } from 'typeorm';
import { ArchiveService } from '../../../src/archive/archive.service';
import { DocEntity } from '../../../src/doc/doc.entity';
import { FileStorageService } from '../../../src/file-storage/file-storage.service';
import { NoteEntity } from '../../../src/note/note.entity';
import { ProjectEntity } from '../../../src/project/project.entity';
import { ResourceEntity } from '../../../src/resource/resource.entity';
import { ThreadEntity } from '../../../src/thread/thread.entity';
import {
  sourceIdForDoc,
  sourceIdForResource,
} from '../../../src/vector/vector-source-id.util';
import { VectorStoreService } from '../../../src/vector/vector-store.service';
import { createMockQueryBuilder } from '../../test-utils';

function repository() {
  const query = createMockQueryBuilder();
  return {
    query,
    createQueryBuilder: jest.fn().mockReturnValue(query),
    findOneBy: jest.fn(),
    update: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
  };
}

describe('ArchiveService', () => {
  let service: ArchiveService;
  let projects: ReturnType<typeof repository>;
  let threads: ReturnType<typeof repository>;
  let docs: ReturnType<typeof repository>;
  let notes: ReturnType<typeof repository>;
  let resources: ReturnType<typeof repository>;
  let files: Record<
    'moveToArchive' | 'archivedFileExists' | 'moveFromArchive',
    jest.Mock
  >;
  let vectors: { deleteWorkspaceSources: jest.Mock };

  beforeEach(async () => {
    projects = repository();
    threads = repository();
    docs = repository();
    notes = repository();
    resources = repository();
    files = {
      moveToArchive: jest.fn(),
      archivedFileExists: jest.fn(),
      moveFromArchive: jest.fn(),
    };
    vectors = { deleteWorkspaceSources: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        ArchiveService,
        { provide: getRepositoryToken(ProjectEntity), useValue: projects },
        { provide: getRepositoryToken(ThreadEntity), useValue: threads },
        { provide: getRepositoryToken(DocEntity), useValue: docs },
        { provide: getRepositoryToken(NoteEntity), useValue: notes },
        { provide: getRepositoryToken(ResourceEntity), useValue: resources },
        { provide: FileStorageService, useValue: files },
        { provide: VectorStoreService, useValue: vectors },
      ],
    }).compile();
    service = module.get(ArchiveService);
  });

  afterEach(() => jest.restoreAllMocks());

  function populateChildren() {
    docs.query.getMany.mockResolvedValue([{ id: 21 }]);
    notes.query.getMany.mockResolvedValue([{ id: 31 }]);
    resources.query.getMany.mockResolvedValue([
      { id: 41, path: 'unique.txt', hash: 'unique' },
      { id: 42, path: 'shared.txt', hash: 'shared' },
      { id: 43, path: null, hash: null },
      { id: 44, path: 'unavailable.txt', hash: 'unavailable' },
      { id: 45, path: 'local.txt', hash: 'local' },
    ]);
  }

  function expectArchived(threadIds: number[]) {
    expect(threads.update).toHaveBeenCalledWith(
      { id: In(threadIds) },
      { status: 'archived' },
    );
    expect(docs.update).toHaveBeenCalledWith(
      { id: In([21]) },
      { status: 'archived' },
    );
    expect(notes.update).toHaveBeenCalledWith(
      { id: In([31]) },
      { status: 'archived' },
    );
    expect(resources.update).toHaveBeenCalledWith(
      { id: In([41, 42, 43, 44, 45]) },
      { archivedAt: expect.any(Date) },
    );
  }

  function expectRestored(threadIds: number[]) {
    expect(threads.update).toHaveBeenCalledWith(
      { id: In(threadIds) },
      { status: 'active' },
    );
    expect(docs.update).toHaveBeenCalledWith(
      { id: In([21]) },
      { status: 'active' },
    );
    expect(notes.update).toHaveBeenCalledWith(
      { id: In([31]) },
      { status: 'active' },
    );
    expect(resources.update).toHaveBeenCalledWith(
      { id: In([41, 42, 43, 44, 45]) },
      { archivedAt: null },
    );
  }

  it('archives project contents and preserves files still in use', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    projects.findOneBy.mockResolvedValue({ id: 1, status: 'active' });
    threads.query.getRawMany.mockResolvedValue([{ id: 10 }, { id: 11 }]);
    populateChildren();
    resources.count.mockImplementation(async ({ where }) =>
      where.hash === 'shared' ? 1 : 0,
    );
    files.moveToArchive.mockImplementation(async (path) => {
      if (path === 'unavailable.txt') throw new Error('volume unavailable');
    });

    await service.archiveProject(1);

    expect(projects.update).toHaveBeenCalledWith(1, { status: 'archived' });
    expectArchived([10, 11]);
    expect(docs.query.where).toHaveBeenCalledWith(
      '(d."projectId" = :projectId OR d."threadId" IN (:...threadIds))',
      { projectId: 1, threadIds: [10, 11] },
    );
    expect(docs.query.andWhere).toHaveBeenCalledWith("d.status = 'active'");
    expect(resources.query.andWhere).toHaveBeenCalledWith(
      'r.archived_at IS NULL',
    );
    expect(resources.count).toHaveBeenCalledWith({
      where: { hash: 'shared', archivedAt: IsNull(), id: Not(42) },
    });
    expect(files.moveToArchive.mock.calls).toEqual([
      ['unique.txt'],
      ['unavailable.txt'],
      ['local.txt'],
    ]);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Failed to move file to archive for resource 44'),
    );
    expect(vectors.deleteWorkspaceSources).toHaveBeenCalledWith([
      ...[41, 42, 43, 44, 45].map(sourceIdForResource),
      sourceIdForDoc(21),
    ]);
  });

  it('restores archived contents and existing archived files', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    projects.findOneBy.mockResolvedValue({ id: 1, status: 'archived' });
    threads.query.getRawMany.mockResolvedValue([{ id: 10 }]);
    populateChildren();
    files.archivedFileExists.mockImplementation(
      async (path) => path === 'unique.txt' || path === 'unavailable.txt',
    );
    files.moveFromArchive.mockImplementation(async (path) => {
      if (path === 'unavailable.txt') throw new Error('volume unavailable');
    });

    await service.unarchiveProject(1);

    expect(projects.update).toHaveBeenCalledWith(1, { status: 'active' });
    expectRestored([10]);
    expect(notes.query.andWhere).toHaveBeenCalledWith("n.status = 'archived'");
    expect(resources.query.andWhere).toHaveBeenCalledWith(
      'r.archived_at IS NOT NULL',
    );
    expect(files.moveFromArchive.mock.calls).toEqual([
      ['unique.txt'],
      ['unavailable.txt'],
    ]);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(
        'Failed to restore file from archive for resource 44',
      ),
    );
    expect(vectors.deleteWorkspaceSources).not.toHaveBeenCalled();
  });

  it.each(['archiveThread', 'unarchiveThread'] as const)(
    '%s includes descendants but leaves the project untouched',
    async (method) => {
      const archiving = method === 'archiveThread';
      threads.findOneBy.mockResolvedValue({
        id: 10,
        status: archiving ? 'active' : 'archived',
      });
      threads.query.getRawMany
        .mockResolvedValueOnce([{ id: 11 }, { id: 12 }])
        .mockResolvedValueOnce([{ id: 13 }])
        .mockResolvedValueOnce([]);
      populateChildren();

      await service[method](10);

      expect(threads.query.where.mock.calls).toEqual([
        ['t."parentId" IN (:...parents)', { parents: [10] }],
        ['t."parentId" IN (:...parents)', { parents: [11, 12] }],
        ['t."parentId" IN (:...parents)', { parents: [13] }],
      ]);
      expect(docs.query.where).toHaveBeenCalledWith(
        '(d."threadId" IN (:...threadIds))',
        { threadIds: [10, 11, 12, 13] },
      );
      expect(projects.update).not.toHaveBeenCalled();
      if (archiving) expectArchived([10, 11, 12, 13]);
      else expectRestored([10, 11, 12, 13]);
    },
  );

  it('changes project or thread state when there are no children to write', async () => {
    projects.findOneBy
      .mockResolvedValueOnce({ status: 'active' })
      .mockResolvedValueOnce({ status: 'archived' });
    threads.findOneBy
      .mockResolvedValueOnce({ status: 'active' })
      .mockResolvedValueOnce({ status: 'archived' });

    await service.archiveProject(1);
    await service.unarchiveProject(1);
    expect(docs.query.where).toHaveBeenCalledWith(
      '(d."projectId" = :projectId)',
      { projectId: 1 },
    );
    expect(threads.update).not.toHaveBeenCalled();
    await service.archiveThread(10);
    await service.unarchiveThread(10);

    for (const repo of [docs, notes, resources])
      expect(repo.update).not.toHaveBeenCalled();
    expect(threads.update.mock.calls).toEqual([
      [{ id: In([10]) }, { status: 'archived' }],
      [{ id: In([10]) }, { status: 'active' }],
    ]);
  });

  it.each([
    ['archiveProject', 'archived'],
    ['unarchiveProject', 'active'],
    ['archiveThread', 'archived'],
    ['unarchiveThread', 'active'],
  ] as const)(
    '%s rejects missing records and is idempotent for existing %s records',
    async (method, status) => {
      await expect(service[method](1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      projects.findOneBy.mockResolvedValue({ status });
      threads.findOneBy.mockResolvedValue({ status });
      await service[method](1);
      expect(projects.update).not.toHaveBeenCalled();
      expect(threads.createQueryBuilder).not.toHaveBeenCalled();
    },
  );
});

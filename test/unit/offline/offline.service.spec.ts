import { OfflineService } from '../../../src/offline/offline.service';
import { DocEntity } from '../../../src/doc/doc.entity';
import { ResourceEntity } from '../../../src/resource/resource.entity';
import { ThreadEntity } from '../../../src/thread/thread.entity';
import { CommentEntity } from '../../../src/comment/comment.entity';
import { MarkEntity } from '../../../src/mark/mark.entity';
import { ReadingPointEntity } from '../../../src/reading-point/reading-point.entity';
import { NoteEntity } from '../../../src/note/note.entity';
import { ProjectEntity } from '../../../src/project/project.entity';
import { createMockRepository, MockRepository } from '../../test-utils';

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
});

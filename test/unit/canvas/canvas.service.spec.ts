import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CanvasService } from '../../../src/canvas/canvas.service';
import { CanvasEntity } from '../../../src/canvas/canvas.entity';
import { createMockRepository, MockRepository } from '../../test-utils';
import { buildCanvas } from '../../factories';

describe('CanvasService', () => {
  let service: CanvasService;
  let repo: MockRepository<CanvasEntity>;

  beforeEach(async () => {
    repo = createMockRepository();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CanvasService,
        { provide: getRepositoryToken(CanvasEntity), useValue: repo },
      ],
    }).compile();
    service = module.get(CanvasService);
  });

  it('should find one', async () => {
    repo.findOneBy.mockResolvedValue(buildCanvas());
    expect(await service.findOne(1)).toBeDefined();
  });

  it('should create canvas', async () => {
    const c = buildCanvas();
    repo.create.mockReturnValue(c);
    repo.save.mockResolvedValue(c);
    expect(await service.create({ name: 'Test' })).toEqual(c);
  });

  it('should find by thread', async () => {
    const qb = repo.createQueryBuilder();
    qb.getMany.mockResolvedValue([buildCanvas()]);
    expect(await service.findByThread(1)).toHaveLength(1);
  });

  it('should find by project', async () => {
    const qb = repo.createQueryBuilder();
    qb.getMany.mockResolvedValue([buildCanvas()]);
    expect(await service.findByProject(1)).toHaveLength(1);
  });

  it('should remove canvas', async () => {
    const c = buildCanvas();
    repo.findOneBy.mockResolvedValue(c);
    repo.remove.mockResolvedValue(c);
    await service.remove(1);
    expect(repo.remove).toHaveBeenCalled();
  });

  it('indexes the visible labels of canvas nodes and preserves its project and thread', async () => {
    repo.create.mockImplementation((row) => row);
    repo.save.mockImplementation(async (row) => row);
    const canvasData = {
      nodes: [
        {
          data: {
            text: 'Text',
            label: 'Label',
            content: 'Body',
            title: 'Title',
          },
        },
        {},
        { data: {} },
        { data: { label: 'Other' } },
      ],
    };
    await expect(
      service.create({
        name: 'Canvas',
        canvasData,
        projectId: 2,
        threadId: 3,
        content: 'Old',
      }),
    ).resolves.toEqual({
      name: 'Canvas',
      canvasData,
      content: 'Text Label Body Title Other',
      project: { id: 2 },
      thread: { id: 3 },
    });
    await expect(
      service.create({ name: 'Manual', content: 'Manual text' }),
    ).resolves.toEqual({ name: 'Manual', content: 'Manual text' });
  });

  it('updates searchable content and nullable relations only when supplied', async () => {
    repo.preload
      .mockResolvedValueOnce(null)
      .mockImplementation(async (row) => row);
    repo.save.mockImplementation(async (row) => row);
    await expect(service.update(999, {})).resolves.toBeNull();
    expect(repo.save).not.toHaveBeenCalled();
    await expect(
      service.update(1, {
        name: 'Renamed',
        content: 'Label',
        projectId: 2,
        threadId: 3,
      }),
    ).resolves.toEqual({
      id: 1,
      name: 'Renamed',
      content: 'Label',
      project: { id: 2 },
      thread: { id: 3 },
    });
    await expect(
      service.update(1, { canvasData: {}, projectId: null, threadId: null }),
    ).resolves.toEqual({
      id: 1,
      canvasData: {},
      content: '',
      project: null,
      thread: null,
    });
    await expect(
      service.update(1, { canvasData: { nodes: 'invalid' } }),
    ).resolves.toMatchObject({ content: '' });
  });

  it('constrains a search to the project and reports a missing canvas without deleting', async () => {
    const qb = repo.createQueryBuilder();
    qb.getRawMany.mockResolvedValue([{ c_id: 5 }]);
    await expect(service.globalSearch('canvas', 7)).resolves.toEqual([
      { c_id: 5 },
    ]);
    expect(qb.andWhere).toHaveBeenCalledWith('c.projectId = :projectId', {
      projectId: 7,
    });
    await expect(service.remove(999)).resolves.toEqual({ deleted: false });
    expect(repo.remove).not.toHaveBeenCalled();
  });
});

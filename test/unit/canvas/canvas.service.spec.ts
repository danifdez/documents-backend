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
      providers: [CanvasService, { provide: getRepositoryToken(CanvasEntity), useValue: repo }],
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
});

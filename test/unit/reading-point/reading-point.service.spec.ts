import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ReadingPointService } from '../../../src/reading-point/reading-point.service';
import { ReadingPointEntity } from '../../../src/reading-point/reading-point.entity';
import { createMockRepository, MockRepository } from '../../test-utils';
import { buildReadingPoint } from '../../factories';

describe('ReadingPointService', () => {
  let service: ReadingPointService;
  let repo: MockRepository<ReadingPointEntity>;

  beforeEach(async () => {
    repo = createMockRepository();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReadingPointService,
        { provide: getRepositoryToken(ReadingPointEntity), useValue: repo },
      ],
    }).compile();
    service = module.get(ReadingPointService);
  });

  it('should find one with doc and resource', async () => {
    repo.findOne.mockResolvedValue(buildReadingPoint());
    expect(await service.findOne(1)).toBeDefined();
    expect(repo.findOne).toHaveBeenCalledWith({
      where: { id: 1 },
      relations: ['doc', 'resource'],
    });
  });

  it('should default kind to section', async () => {
    repo.create.mockImplementation((value: any) => value);
    repo.save.mockImplementation(async (value: any) => value);
    const created = await service.create({ exact: 'text' });
    expect(created.kind).toBe('section');
  });

  it('should keep explicit kind', async () => {
    repo.create.mockImplementation((value: any) => value);
    repo.save.mockImplementation(async (value: any) => value);
    const created = await service.create({ exact: 'text', kind: 'section' });
    expect(created.kind).toBe('section');
  });

  it('should replace the existing reading mark of the same doc', async () => {
    (repo.manager as any).transaction = jest.fn(async (cb: any) =>
      cb(repo.manager),
    );
    (repo.manager as any).getRepository.mockReturnValue(repo);
    repo.delete.mockResolvedValue({ affected: 1 });
    repo.create.mockImplementation((value: any) => value);
    repo.save.mockImplementation(async (value: any) => value);

    await service.create({
      kind: 'reading',
      exact: 'text',
      doc: { id: 7 } as any,
    });

    expect(repo.delete).toHaveBeenCalledWith({
      kind: 'reading',
      doc: { id: 7 },
    });
    expect(repo.save).toHaveBeenCalled();
  });

  it('should find by doc', async () => {
    repo.find.mockResolvedValue([buildReadingPoint()]);
    expect(await service.findByDoc(1)).toHaveLength(1);
  });

  it('should find by resource', async () => {
    repo.find.mockResolvedValue([buildReadingPoint()]);
    expect(await service.findByResource(1)).toHaveLength(1);
  });

  it('should return null when updating a missing point', async () => {
    repo.findOneBy.mockResolvedValue(null);
    expect(await service.update(1, { label: 'x' })).toBeNull();
  });

  it('should update an existing point', async () => {
    const point = buildReadingPoint();
    repo.findOneBy.mockResolvedValue(point);
    repo.save.mockImplementation(async (value: any) => value);
    const updated = await service.update(1, { label: 'Chapter 2' });
    expect(updated?.label).toBe('Chapter 2');
  });

  it('should delete', async () => {
    repo.delete.mockResolvedValue({ affected: 1 });
    await service.delete(1);
    expect(repo.delete).toHaveBeenCalledWith({ id: 1 });
  });
});

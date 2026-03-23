import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NoteService } from '../../../src/note/note.service';
import { NoteEntity } from '../../../src/note/note.entity';
import { createMockRepository, MockRepository } from '../../test-utils';
import { buildNote } from '../../factories';

describe('NoteService', () => {
  let service: NoteService;
  let repo: MockRepository<NoteEntity>;

  beforeEach(async () => {
    repo = createMockRepository();
    const module: TestingModule = await Test.createTestingModule({
      providers: [NoteService, { provide: getRepositoryToken(NoteEntity), useValue: repo }],
    }).compile();
    service = module.get(NoteService);
  });

  it('should find all with project relation', async () => {
    repo.find.mockResolvedValue([buildNote()]);
    const result = await service.findAll();
    expect(result).toHaveLength(1);
  });

  it('should find one by id with project', async () => {
    const n = buildNote();
    repo.findOne.mockResolvedValue(n);
    expect(await service.findOne(1)).toEqual(n);
  });

  it('should create note', async () => {
    const n = buildNote();
    repo.create.mockReturnValue(n);
    repo.save.mockResolvedValue(n);
    expect(await service.create({ title: 'Test' })).toEqual(n);
  });

  it('should update note', async () => {
    const n = buildNote({ title: 'Updated' });
    repo.preload.mockResolvedValue(n);
    repo.save.mockResolvedValue(n);
    expect(await service.update(1, { title: 'Updated' })).toEqual(n);
  });

  it('should return null on update if not found', async () => {
    repo.preload.mockResolvedValue(undefined);
    expect(await service.update(999, {})).toBeNull();
  });

  it('should remove note', async () => {
    const n = buildNote();
    repo.findOneBy.mockResolvedValue(n);
    repo.remove.mockResolvedValue(n);
    expect(await service.remove(1)).toEqual({ deleted: true });
  });

  it('should return deleted:false if not found', async () => {
    repo.findOneBy.mockResolvedValue(null);
    expect(await service.remove(999)).toEqual({ deleted: false });
  });
});

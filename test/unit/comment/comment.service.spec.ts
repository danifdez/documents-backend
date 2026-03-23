import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CommentService } from '../../../src/comment/comment.service';
import { CommentEntity } from '../../../src/comment/comment.entity';
import { createMockRepository, MockRepository } from '../../test-utils';
import { buildComment } from '../../factories';

describe('CommentService', () => {
  let service: CommentService;
  let repo: MockRepository<CommentEntity>;

  beforeEach(async () => {
    repo = createMockRepository();
    const module: TestingModule = await Test.createTestingModule({
      providers: [CommentService, { provide: getRepositoryToken(CommentEntity), useValue: repo }],
    }).compile();
    service = module.get(CommentService);
  });

  it('should find one by id', async () => {
    const c = buildComment();
    repo.findOneBy.mockResolvedValue(c);
    expect(await service.findOne(1)).toEqual(c);
  });

  it('should create comment', async () => {
    const c = buildComment();
    repo.create.mockReturnValue(c);
    repo.save.mockResolvedValue(c);
    expect(await service.create({ content: 'test' })).toEqual(c);
  });

  it('should find by doc', async () => {
    repo.find.mockResolvedValue([buildComment()]);
    const result = await service.findByDoc(1);
    expect(result).toHaveLength(1);
  });

  it('should find by resource', async () => {
    repo.find.mockResolvedValue([buildComment()]);
    const result = await service.findByResource(1);
    expect(result).toHaveLength(1);
  });

  it('should update comment', async () => {
    const c = buildComment({ content: 'updated' });
    repo.preload.mockResolvedValue(c);
    repo.save.mockResolvedValue(c);
    expect(await service.update(1, { content: 'updated' })).toEqual(c);
  });

  it('should return null on update if not found', async () => {
    repo.preload.mockResolvedValue(undefined);
    expect(await service.update(999, {})).toBeNull();
  });

  it('should delete comment', async () => {
    repo.delete.mockResolvedValue({ affected: 1 });
    await service.delete(1);
    expect(repo.delete).toHaveBeenCalledWith({ id: 1 });
  });
});

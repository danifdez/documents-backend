import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { FavoriteCategoryService } from '../../../src/favorite/favorite-category.service';
import { FavoriteCategoryEntity } from '../../../src/favorite/favorite-category.entity';
import { createMockRepository, MockRepository } from '../../test-utils';

describe('FavoriteCategoryService', () => {
  let service: FavoriteCategoryService;
  let repo: MockRepository<FavoriteCategoryEntity>;

  beforeEach(async () => {
    repo = createMockRepository();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FavoriteCategoryService,
        { provide: getRepositoryToken(FavoriteCategoryEntity), useValue: repo },
      ],
    }).compile();
    service = module.get(FavoriteCategoryService);
  });

  it('creates a root category', async () => {
    const qb = repo.createQueryBuilder();
    qb.getOne.mockResolvedValue(null);
    const created = {
      id: 1,
      name: 'News',
      parentId: null,
    } as FavoriteCategoryEntity;
    repo.create.mockReturnValue(created);
    repo.save.mockResolvedValue(created);

    expect(await service.create({ projectId: 1, name: 'News' })).toEqual(
      created,
    );
    expect(repo.save).toHaveBeenCalled();
  });

  it('rejects a duplicate sibling name', async () => {
    const qb = repo.createQueryBuilder();
    qb.getOne.mockResolvedValue({ id: 9, name: 'News' });

    await expect(
      service.create({ projectId: 1, name: 'news' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('rejects a parent from another project', async () => {
    repo.findOne.mockResolvedValue(null);

    await expect(
      service.create({ projectId: 1, name: 'Child', parentId: 99 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects nesting a category inside itself', async () => {
    repo.findOne
      .mockResolvedValueOnce({
        id: 5,
        name: 'A',
        project: { id: 1 },
        parentId: null,
      })
      .mockResolvedValueOnce({ id: 6, name: 'B', parentId: 5 });
    repo.findOneBy.mockResolvedValue({ id: 6, parentId: 5 });

    await expect(service.update(5, { parentId: 6 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('returns null when updating a missing category', async () => {
    repo.findOne.mockResolvedValue(null);

    expect(await service.update(404, { name: 'X' })).toBeNull();
  });

  it('removes a category', async () => {
    repo.findOneBy.mockResolvedValue({ id: 1 } as FavoriteCategoryEntity);
    repo.remove.mockResolvedValue({ id: 1 });

    expect(await service.remove(1)).toEqual({ deleted: true });
  });

  it('reports when there is nothing to remove', async () => {
    repo.findOneBy.mockResolvedValue(null);

    expect(await service.remove(404)).toEqual({ deleted: false });
  });
});

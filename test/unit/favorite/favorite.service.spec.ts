import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { FavoriteService } from '../../../src/favorite/favorite.service';
import { FavoriteEntity } from '../../../src/favorite/favorite.entity';
import { FavoriteCategoryEntity } from '../../../src/favorite/favorite-category.entity';
import { createMockRepository, MockRepository } from '../../test-utils';

describe('FavoriteService', () => {
  let service: FavoriteService;
  let repo: MockRepository<FavoriteEntity>;
  let categoryRepo: MockRepository<FavoriteCategoryEntity>;

  beforeEach(async () => {
    repo = createMockRepository();
    categoryRepo = createMockRepository();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FavoriteService,
        { provide: getRepositoryToken(FavoriteEntity), useValue: repo },
        {
          provide: getRepositoryToken(FavoriteCategoryEntity),
          useValue: categoryRepo,
        },
      ],
    }).compile();
    service = module.get(FavoriteService);
  });

  it('rejects a category from another project on upsert', async () => {
    repo.findOne.mockResolvedValue(null);
    categoryRepo.findOne.mockResolvedValue(null);

    await expect(
      service.upsert({
        projectId: 1,
        url: 'https://example.com',
        categoryId: 7,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('assigns a category on update', async () => {
    const favorite = {
      id: 3,
      title: 'Example',
      project: { id: 1 },
      categoryId: null,
      category: null,
    };
    repo.findOne.mockResolvedValue(favorite);
    categoryRepo.findOne.mockResolvedValue({ id: 7 });
    repo.save.mockImplementation(async (f: FavoriteEntity) => f);

    const result = await service.update(3, { categoryId: 7 });

    expect(result.category).toEqual({ id: 7 });
  });

  it('updates the url', async () => {
    const favorite = {
      id: 3,
      url: 'https://old.example.com',
      title: '',
      project: { id: 1 },
      categoryId: null,
      category: null,
    };
    repo.findOne.mockResolvedValueOnce(favorite).mockResolvedValueOnce(null);
    repo.save.mockImplementation(async (f: FavoriteEntity) => f);

    const result = await service.update(3, { url: 'https://new.example.com' });

    expect(result.url).toBe('https://new.example.com');
  });

  it('rejects a url already used by another favorite', async () => {
    const favorite = {
      id: 3,
      url: 'https://old.example.com',
      title: '',
      project: { id: 1 },
      categoryId: null,
      category: null,
    };
    repo.findOne
      .mockResolvedValueOnce(favorite)
      .mockResolvedValueOnce({ id: 9, url: 'https://new.example.com' });

    await expect(
      service.update(3, { url: 'https://new.example.com' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('clears the category when null is provided', async () => {
    const favorite = {
      id: 3,
      title: 'Example',
      project: { id: 1 },
      categoryId: 7,
      category: { id: 7 },
    };
    repo.findOne.mockResolvedValue(favorite);
    repo.save.mockImplementation(async (f: FavoriteEntity) => f);

    const result = await service.update(3, { categoryId: null });

    expect(result.category).toBeNull();
    expect(categoryRepo.findOne).not.toHaveBeenCalled();
  });
});

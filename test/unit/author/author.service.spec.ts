import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuthorService } from '../../../src/author/author.service';
import { AuthorEntity } from '../../../src/author/author.entity';
import { createMockRepository, MockRepository } from '../../test-utils';
import { buildAuthor } from '../../factories';

describe('AuthorService', () => {
  let service: AuthorService;
  let repo: MockRepository<AuthorEntity>;

  beforeEach(async () => {
    repo = createMockRepository<AuthorEntity>();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthorService,
        { provide: getRepositoryToken(AuthorEntity), useValue: repo },
      ],
    }).compile();

    service = module.get<AuthorService>(AuthorService);
  });

  describe('findOne', () => {
    it('should return an author by id', async () => {
      const author = buildAuthor();
      repo.findOne.mockResolvedValue(author);

      const result = await service.findOne(1);
      expect(result).toEqual(author);
      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 1 } });
    });

    it('should return null if not found', async () => {
      repo.findOne.mockResolvedValue(null);
      const result = await service.findOne(999);
      expect(result).toBeNull();
    });
  });

  describe('findByName', () => {
    it('should return author matching name case-insensitively', async () => {
      const author = buildAuthor({ name: 'John Doe' });
      const qb = repo.createQueryBuilder();
      qb.getMany.mockResolvedValue([author]);

      const result = await service.findByName('john doe');
      expect(result).toEqual(author);
    });

    it('should return null if no match', async () => {
      const qb = repo.createQueryBuilder();
      qb.getMany.mockResolvedValue([]);

      const result = await service.findByName('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('findAll', () => {
    it('should return all authors', async () => {
      const authors = [buildAuthor({ id: 1 }), buildAuthor({ id: 2, name: 'Author 2' })];
      repo.find.mockResolvedValue(authors);

      const result = await service.findAll();
      expect(result).toEqual(authors);
    });
  });

  describe('create', () => {
    it('should create and save a new author', async () => {
      const author = buildAuthor();
      repo.create.mockReturnValue(author);
      repo.save.mockResolvedValue(author);

      const result = await service.create({ name: 'Test Author' });
      expect(result).toEqual(author);
      expect(repo.create).toHaveBeenCalledWith({ name: 'Test Author' });
      expect(repo.save).toHaveBeenCalledWith(author);
    });
  });

  describe('findOrCreate', () => {
    it('should return existing author if found', async () => {
      const author = buildAuthor();
      const qb = repo.createQueryBuilder();
      qb.getMany.mockResolvedValue([author]);

      const result = await service.findOrCreate('Test Author');
      expect(result).toEqual(author);
    });

    it('should create new author if not found', async () => {
      const author = buildAuthor();
      const qb = repo.createQueryBuilder();
      qb.getMany.mockResolvedValue([]);
      repo.create.mockReturnValue(author);
      repo.save.mockResolvedValue(author);

      const result = await service.findOrCreate('Test Author');
      expect(result).toEqual(author);
      expect(repo.create).toHaveBeenCalled();
    });

    it('should throw BadRequestException if name is empty', async () => {
      await expect(service.findOrCreate('   ')).rejects.toThrow('Author name cannot be empty');
    });
  });

  describe('update', () => {
    it('should update an existing author', async () => {
      const author = buildAuthor({ name: 'Updated' });
      repo.preload.mockResolvedValue(author);
      repo.save.mockResolvedValue(author);

      const result = await service.update(1, { name: 'Updated' });
      expect(result).toEqual(author);
    });

    it('should return null if author not found', async () => {
      repo.preload.mockResolvedValue(undefined);
      const result = await service.update(999, { name: 'x' });
      expect(result).toBeNull();
    });
  });

  describe('remove', () => {
    it('should remove an existing author', async () => {
      const author = buildAuthor();
      repo.findOneBy.mockResolvedValue(author);
      repo.remove.mockResolvedValue(author);

      const result = await service.remove(1);
      expect(result).toEqual(author);
      expect(repo.remove).toHaveBeenCalledWith(author);
    });

    it('should return null if author not found', async () => {
      repo.findOneBy.mockResolvedValue(null);
      const result = await service.remove(999);
      expect(result).toBeNull();
    });
  });
});

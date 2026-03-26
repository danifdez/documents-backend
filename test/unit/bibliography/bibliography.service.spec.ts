import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BibliographyService } from '../../../src/bibliography/bibliography.service';
import { BibliographyEntryEntity } from '../../../src/bibliography/bibliography-entry.entity';
import { ResourceEntity } from '../../../src/resource/resource.entity';
import { createMockRepository, MockRepository } from '../../test-utils';
import { buildBibliographyEntry, buildResource, buildAuthor } from '../../factories';

describe('BibliographyService', () => {
  let service: BibliographyService;
  let repo: MockRepository<BibliographyEntryEntity>;
  let resourceRepo: MockRepository<ResourceEntity>;

  beforeEach(async () => {
    repo = createMockRepository<BibliographyEntryEntity>();
    resourceRepo = createMockRepository<ResourceEntity>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BibliographyService,
        { provide: getRepositoryToken(BibliographyEntryEntity), useValue: repo },
        { provide: getRepositoryToken(ResourceEntity), useValue: resourceRepo },
      ],
    }).compile();

    service = module.get(BibliographyService);
  });

  describe('findOne', () => {
    it('should find entry by id with relations', async () => {
      const entry = buildBibliographyEntry();
      repo.findOne.mockResolvedValue(entry);
      expect(await service.findOne(1)).toEqual(entry);
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: 1 },
        relations: ['project', 'sourceResource'],
      });
    });

    it('should return null when not found', async () => {
      repo.findOne.mockResolvedValue(null);
      expect(await service.findOne(999)).toBeNull();
    });
  });

  describe('findAll', () => {
    it('should return all entries via query builder', async () => {
      const entries = [buildBibliographyEntry()];
      const qb = repo.createQueryBuilder();
      qb.getMany.mockResolvedValue(entries);
      expect(await service.findAll()).toEqual(entries);
    });
  });

  describe('findGlobal', () => {
    it('should return entries with null project', async () => {
      const entries = [buildBibliographyEntry()];
      const qb = repo.createQueryBuilder();
      qb.getMany.mockResolvedValue(entries);
      expect(await service.findGlobal()).toEqual(entries);
      expect(qb.where).toHaveBeenCalledWith('b.projectId IS NULL');
    });
  });

  describe('findByProject', () => {
    it('should return entries for project and global entries', async () => {
      const entries = [buildBibliographyEntry()];
      const qb = repo.createQueryBuilder();
      qb.getMany.mockResolvedValue(entries);
      expect(await service.findByProject(1)).toEqual(entries);
      expect(qb.where).toHaveBeenCalledWith(
        'b.projectId = :projectId OR b.projectId IS NULL',
        { projectId: 1 },
      );
    });
  });

  describe('create', () => {
    it('should create and save a bibliography entry', async () => {
      const entry = buildBibliographyEntry();
      repo.create.mockReturnValue(entry);
      repo.save.mockResolvedValue(entry);
      expect(await service.create({ title: 'Test' })).toEqual(entry);
    });
  });

  describe('update', () => {
    it('should update an existing entry', async () => {
      const entry = buildBibliographyEntry({ title: 'Updated' });
      repo.preload.mockResolvedValue(entry);
      repo.save.mockResolvedValue(entry);
      expect(await service.update(1, { title: 'Updated' })).toEqual(entry);
    });

    it('should return null if not found', async () => {
      repo.preload.mockResolvedValue(undefined);
      expect(await service.update(999, { title: 'X' })).toBeNull();
    });
  });

  describe('remove', () => {
    it('should remove an existing entry', async () => {
      const entry = buildBibliographyEntry();
      repo.findOneBy.mockResolvedValue(entry);
      repo.remove.mockResolvedValue(entry);
      expect(await service.remove(1)).toEqual({ deleted: true });
    });

    it('should return deleted false when not found', async () => {
      repo.findOneBy.mockResolvedValue(null);
      expect(await service.remove(999)).toEqual({ deleted: false });
    });
  });

  describe('assignProject', () => {
    it('should update project and return refreshed entry', async () => {
      const qb = repo.createQueryBuilder();
      qb.execute.mockResolvedValue({ affected: 1 });
      const entry = buildBibliographyEntry();
      repo.findOne.mockResolvedValue(entry);

      const result = await service.assignProject(1, 5);
      expect(result).toEqual(entry);
    });
  });

  describe('makeGlobal', () => {
    it('should set project to null and return refreshed entry', async () => {
      const qb = repo.createQueryBuilder();
      qb.execute.mockResolvedValue({ affected: 1 });
      const entry = buildBibliographyEntry();
      repo.findOne.mockResolvedValue(entry);

      const result = await service.makeGlobal(1);
      expect(result).toEqual(entry);
    });
  });

  describe('importFromResource', () => {
    it('should return existing entry if already imported', async () => {
      const existing = buildBibliographyEntry();
      repo.findOne.mockResolvedValue(existing);
      expect(await service.importFromResource(1, 5)).toEqual(existing);
    });

    it('should create new entry from resource when not existing', async () => {
      repo.findOne.mockResolvedValue(null);
      const resource = buildResource({
        title: 'My Article',
        publicationDate: '2024-06-15' as any,
        url: 'https://example.com',
        authors: [buildAuthor({ name: 'John Doe' })],
      });
      resourceRepo.findOne.mockResolvedValue(resource);
      const newEntry = buildBibliographyEntry({ title: 'My Article' });
      repo.create.mockReturnValue(newEntry);
      repo.save.mockResolvedValue(newEntry);

      const result = await service.importFromResource(1, 5);
      expect(result).toEqual(newEntry);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          entryType: 'misc',
          title: 'My Article',
        }),
      );
    });

    it('should throw when resource not found', async () => {
      repo.findOne.mockResolvedValue(null);
      resourceRepo.findOne.mockResolvedValue(null);
      await expect(service.importFromResource(999)).rejects.toThrow('Resource 999 not found');
    });

    it('should parse "LastName, FirstName" format for authors', async () => {
      repo.findOne.mockResolvedValue(null);
      const resource = buildResource({
        title: 'Test',
        authors: [buildAuthor({ name: 'Smith, John' })],
      });
      resourceRepo.findOne.mockResolvedValue(resource);
      repo.create.mockImplementation((data) => data as any);
      repo.save.mockImplementation(async (e) => e);

      const result = await service.importFromResource(1);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          creators: expect.arrayContaining([
            { creatorType: 'author', lastName: 'Smith', firstName: 'John' },
          ]),
        }),
      );
    });
  });

  describe('importBibTeX', () => {
    it('should parse and save BibTeX entries', async () => {
      const bibtex = `@article{doe2024,
  title = {Test Article},
  author = {Doe, John and Smith, Jane},
  year = {2024},
  journal = {Test Journal},
}`;
      const entries = [buildBibliographyEntry()];
      repo.create.mockImplementation((data) => data as any);
      repo.save.mockResolvedValue(entries);

      const result = await service.importBibTeX(bibtex, 1);
      expect(repo.create).toHaveBeenCalled();
      expect(repo.save).toHaveBeenCalled();
    });

    it('should parse multiple article entries', async () => {
      const bibtex = `@article{doe2024,
  title = {First Article},
  year = {2024},
}

@book{smith2023,
  title = {A Book},
  year = {2023},
}`;
      repo.create.mockImplementation((data) => data as any);
      repo.save.mockResolvedValue([]);

      await service.importBibTeX(bibtex);
      expect(repo.create).toHaveBeenCalledTimes(2);
    });

    it('should map thesis type correctly', async () => {
      const bibtex = `@phdthesis{smith2024,
  title = {My Thesis},
  author = {Smith, Alice},
  year = {2024},
  school = {MIT},
}`;
      repo.create.mockImplementation((data) => data as any);
      repo.save.mockResolvedValue([]);

      await service.importBibTeX(bibtex);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          entryType: 'thesis',
          university: 'MIT',
        }),
      );
    });
  });

  describe('exportBibTeX', () => {
    it('should export entries as BibTeX string', async () => {
      const entry = buildBibliographyEntry({
        entryType: 'journalArticle',
        citeKey: 'doe2025',
        title: 'Test Article',
        year: '2025',
        creators: [{ creatorType: 'author', lastName: 'Doe', firstName: 'John' }],
      });
      const qb = repo.createQueryBuilder();
      qb.getMany.mockResolvedValue([entry]);

      const result = await service.exportBibTeX(1);
      expect(result).toContain('@article{doe2025,');
      expect(result).toContain('title = {Test Article}');
      expect(result).toContain('author = {Doe, John}');
      expect(result).toContain('year = {2025}');
    });

    it('should filter by specific ids when provided', async () => {
      const qb = repo.createQueryBuilder();
      qb.getMany.mockResolvedValue([]);

      await service.exportBibTeX(undefined, [1, 2, 3]);
      expect(qb.where).toHaveBeenCalledWith('b.id IN (:...ids)', { ids: [1, 2, 3] });
    });
  });
});

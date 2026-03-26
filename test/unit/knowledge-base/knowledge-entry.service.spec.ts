import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { KnowledgeEntryService } from '../../../src/knowledge-base/knowledge-entry.service';
import { KnowledgeEntryEntity } from '../../../src/knowledge-base/knowledge-entry.entity';
import { JobService } from '../../../src/job/job.service';
import { createMockRepository, MockRepository } from '../../test-utils';
import { buildKnowledgeEntry } from '../../factories';

describe('KnowledgeEntryService', () => {
  let service: KnowledgeEntryService;
  let repo: MockRepository<KnowledgeEntryEntity>;
  let jobService: Record<string, jest.Mock>;

  beforeEach(async () => {
    repo = createMockRepository<KnowledgeEntryEntity>();
    jobService = { create: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KnowledgeEntryService,
        { provide: getRepositoryToken(KnowledgeEntryEntity), useValue: repo },
        { provide: JobService, useValue: jobService },
      ],
    }).compile();

    service = module.get(KnowledgeEntryService);
  });

  describe('findAll', () => {
    it('should return all entries ordered by updatedAt DESC', async () => {
      const entries = [buildKnowledgeEntry()];
      repo.find.mockResolvedValue(entries);
      expect(await service.findAll()).toEqual(entries);
      expect(repo.find).toHaveBeenCalledWith({ order: { updatedAt: 'DESC' } });
    });
  });

  describe('findOne', () => {
    it('should find by id', async () => {
      const entry = buildKnowledgeEntry();
      repo.findOneBy.mockResolvedValue(entry);
      expect(await service.findOne(1)).toEqual(entry);
    });

    it('should return null when not found', async () => {
      repo.findOneBy.mockResolvedValue(null);
      expect(await service.findOne(999)).toBeNull();
    });
  });

  describe('search', () => {
    it('should return empty array for empty search term', async () => {
      expect(await service.search('')).toEqual([]);
      expect(await service.search('   ')).toEqual([]);
    });

    it('should search by title, content, and summary', async () => {
      const entries = [buildKnowledgeEntry()];
      const qb = repo.createQueryBuilder();
      qb.getMany.mockResolvedValue(entries);
      expect(await service.search('test')).toEqual(entries);
      expect(qb.where).toHaveBeenCalledWith(
        'k.title ILIKE :q OR k.content ILIKE :q OR k.summary ILIKE :q',
        { q: '%test%' },
      );
    });
  });

  describe('globalSearch', () => {
    it('should return empty array for empty term', async () => {
      expect(await service.globalSearch('')).toEqual([]);
    });

    it('should use similarity scoring', async () => {
      const qb = repo.createQueryBuilder();
      qb.getRawMany.mockResolvedValue([{ k_id: 1, k_title: 'Test', score: 0.8 }]);
      const result = await service.globalSearch('test');
      expect(result).toHaveLength(1);
      expect(qb.addSelect).toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('should create entry and schedule ingest', async () => {
      const entry = buildKnowledgeEntry({ title: 'New Entry', content: '<p>Content</p>' });
      repo.create.mockReturnValue(entry);
      repo.save.mockResolvedValue(entry);

      const result = await service.create({ title: 'New Entry', content: '<p>Content</p>' });
      expect(result).toEqual(entry);
      expect(jobService.create).toHaveBeenCalledWith(
        'ingest-content',
        expect.any(String),
        expect.objectContaining({
          knowledgeEntryId: entry.id,
          sourceType: 'knowledge',
        }),
      );
    });
  });

  describe('update', () => {
    it('should update and re-ingest when content changes', async () => {
      const entry = buildKnowledgeEntry({ title: 'Updated' });
      repo.preload.mockResolvedValue(entry);
      repo.save.mockResolvedValue(entry);

      const result = await service.update(1, { title: 'Updated' });
      expect(result).toEqual(entry);
      expect(jobService.create).toHaveBeenCalled();
    });

    it('should return null if entry not found', async () => {
      repo.preload.mockResolvedValue(undefined);
      expect(await service.update(999, { title: 'X' })).toBeNull();
    });

    it('should not schedule ingest when only non-content fields change', async () => {
      const entry = buildKnowledgeEntry();
      repo.preload.mockResolvedValue(entry);
      repo.save.mockResolvedValue(entry);

      await service.update(1, { tags: ['new-tag'] } as any);
      expect(jobService.create).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should remove entry and schedule vector deletion', async () => {
      const entry = buildKnowledgeEntry();
      repo.findOneBy.mockResolvedValue(entry);
      repo.remove.mockResolvedValue(entry);

      const result = await service.remove(1);
      expect(result).toEqual({ deleted: true });
      expect(jobService.create).toHaveBeenCalledWith(
        'delete-vectors',
        expect.any(String),
        { sourceId: 'knowledge_1' },
      );
    });

    it('should return deleted false when not found', async () => {
      repo.findOneBy.mockResolvedValue(null);
      expect(await service.remove(999)).toEqual({ deleted: false });
      expect(jobService.create).not.toHaveBeenCalled();
    });
  });
});

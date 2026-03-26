import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ProjectService } from '../../../src/project/project.service';
import { ProjectEntity } from '../../../src/project/project.entity';
import { createMockRepository, MockRepository } from '../../test-utils';
import { buildProject } from '../../factories';

describe('ProjectService', () => {
  let service: ProjectService;
  let repo: MockRepository<ProjectEntity>;
  let mockQueryRunner: Record<string, jest.Mock>;
  let dataSource: { createQueryRunner: jest.Mock };

  beforeEach(async () => {
    repo = createMockRepository();
    mockQueryRunner = {
      query: jest.fn(),
      release: jest.fn(),
    };
    dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectService,
        { provide: getRepositoryToken(ProjectEntity), useValue: repo },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();
    service = module.get(ProjectService);
  });

  describe('findAll', () => {
    it('should return all projects', async () => {
      repo.find.mockResolvedValue([buildProject()]);
      expect(await service.findAll()).toHaveLength(1);
    });

    it('should return empty array when no projects exist', async () => {
      repo.find.mockResolvedValue([]);
      expect(await service.findAll()).toEqual([]);
    });
  });

  describe('findOne', () => {
    it('should find one by id', async () => {
      const p = buildProject();
      repo.findOneBy.mockResolvedValue(p);
      expect(await service.findOne(1)).toEqual(p);
    });

    it('should return null when not found', async () => {
      repo.findOneBy.mockResolvedValue(null);
      expect(await service.findOne(999)).toBeNull();
    });
  });

  describe('create', () => {
    it('should create and save a project', async () => {
      const p = buildProject();
      repo.create.mockReturnValue(p);
      repo.save.mockResolvedValue(p);
      const result = await service.create({ name: 'Test' });
      expect(result).toEqual(p);
      expect(repo.create).toHaveBeenCalledWith({ name: 'Test' });
      expect(repo.save).toHaveBeenCalledWith(p);
    });
  });

  describe('update', () => {
    it('should update an existing project', async () => {
      const p = buildProject({ name: 'Updated' });
      repo.findOneBy.mockResolvedValue(p);
      repo.save.mockResolvedValue(p);
      expect(await service.update(1, { name: 'Updated' })).toEqual(p);
    });

    it('should return null if project not found', async () => {
      repo.findOneBy.mockResolvedValue(null);
      expect(await service.update(999, {})).toBeNull();
    });

    it('should merge partial data into existing entity', async () => {
      const existing = buildProject({ name: 'Original', description: 'Desc' });
      repo.findOneBy.mockResolvedValue(existing);
      repo.save.mockImplementation(async (e) => e);
      await service.update(1, { name: 'NewName' });
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'NewName' }),
      );
    });
  });

  describe('remove', () => {
    it('should remove an existing project', async () => {
      const p = buildProject();
      repo.findOneBy.mockResolvedValue(p);
      repo.remove.mockResolvedValue(p);
      await service.remove(1);
      expect(repo.remove).toHaveBeenCalledWith(p);
    });

    it('should do nothing if project not found', async () => {
      repo.findOneBy.mockResolvedValue(null);
      await service.remove(999);
      expect(repo.remove).not.toHaveBeenCalled();
    });
  });

  describe('search', () => {
    it('should return all on empty search string', async () => {
      repo.find.mockResolvedValue([buildProject()]);
      expect(await service.search('')).toHaveLength(1);
    });

    it('should return all on whitespace-only search', async () => {
      repo.find.mockResolvedValue([buildProject()]);
      expect(await service.search('   ')).toHaveLength(1);
    });

    it('should return all on null/undefined search', async () => {
      repo.find.mockResolvedValue([]);
      expect(await service.search(null as any)).toEqual([]);
    });

    it('should search by name with query builder', async () => {
      const qb = repo.createQueryBuilder();
      qb.getMany.mockResolvedValue([buildProject()]);
      const result = await service.search('test');
      expect(result).toHaveLength(1);
      expect(qb.where).toHaveBeenCalledWith(
        'p.name ILIKE :q OR p.description ILIKE :q',
        { q: '%test%' },
      );
    });
  });

  describe('getStats', () => {
    it('should return aggregated stats for a project', async () => {
      const countsRow = {
        resourceCount: '5',
        docCount: '3',
        noteCount: '2',
        datasetCount: '1',
        bibliographyCount: '4',
        entityCount: '10',
      };
      const languages = [{ language: 'en' }, { language: 'es' }];
      const keywordsRaw = [
        { kw: 'machine-learning', count: 5 },
        { kw: 'nlp', count: 3 },
      ];
      const topEntities = [{ name: 'Entity1', type: 'Person', count: 4 }];
      const topAuthors = [{ name: 'Author1', count: 3 }];
      const bibByYear = [{ year: '2024', count: 2 }];
      const bibByType = [{ type: 'article', count: 3 }];
      const cooccurrence = [{ source: 'E1', target: 'E2', weight: 2 }];
      const keyPointsRaw = [
        { resourceName: 'Res1', keyPoints: JSON.stringify(['Point A', 'Point B']) },
      ];
      const timelineEvents = [
        { name: 'TL1', timelineData: JSON.stringify([{ date: '2024-01-01', title: 'Event 1' }]) },
      ];

      // Mock all 10 query calls in order
      mockQueryRunner.query
        .mockResolvedValueOnce([countsRow])       // counts
        .mockResolvedValueOnce(languages)          // languages
        .mockResolvedValueOnce(keywordsRaw)        // keywords
        .mockResolvedValueOnce(topEntities)        // top entities
        .mockResolvedValueOnce(topAuthors)         // top authors
        .mockResolvedValueOnce(bibByYear)          // bib by year
        .mockResolvedValueOnce(bibByType)          // bib by type
        .mockResolvedValueOnce(cooccurrence)       // co-occurrence
        .mockResolvedValueOnce(keyPointsRaw)       // key points
        .mockResolvedValueOnce(timelineEvents);    // timeline events

      const result = await service.getStats(1);

      expect(dataSource.createQueryRunner).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
      expect(mockQueryRunner.query).toHaveBeenCalledTimes(10);

      // Verify structure
      expect(result.resourceCount).toBe('5');
      expect(result.languages).toEqual(['en', 'es']);
      expect(result.topKeywords).toEqual([
        { word: 'machine-learning', count: 5 },
        { word: 'nlp', count: 3 },
      ]);
      expect(result.topEntities).toEqual([{ name: 'Entity1', type: 'Person', count: 4 }]);
      expect(result.topAuthors).toEqual([{ name: 'Author1', count: 3 }]);
      expect(result.bibliographyByYear).toEqual([{ year: '2024', count: 2 }]);
      expect(result.bibliographyByType).toEqual([{ type: 'article', count: 3 }]);
      expect(result.entityCooccurrence).toEqual([{ source: 'E1', target: 'E2', weight: 2 }]);
      expect(result.keyPoints).toEqual([
        { text: 'Point A', source: 'Res1' },
        { text: 'Point B', source: 'Res1' },
      ]);
      expect(result.timelineEvents).toEqual([
        { date: '2024-01-01', label: 'Event 1', endDate: undefined },
      ]);
    });

    it('should handle empty stats gracefully', async () => {
      const emptyCountsRow = {
        resourceCount: '0',
        docCount: '0',
        noteCount: '0',
        datasetCount: '0',
        bibliographyCount: '0',
        entityCount: '0',
      };

      mockQueryRunner.query
        .mockResolvedValueOnce([emptyCountsRow])
        .mockResolvedValueOnce([])   // languages
        .mockResolvedValueOnce([])   // keywords
        .mockResolvedValueOnce([])   // entities
        .mockResolvedValueOnce([])   // authors
        .mockResolvedValueOnce([])   // bib year
        .mockResolvedValueOnce([])   // bib type
        .mockResolvedValueOnce([])   // co-occurrence
        .mockResolvedValueOnce([])   // key points
        .mockResolvedValueOnce([]);  // timeline

      const result = await service.getStats(1);

      expect(result.languages).toEqual([]);
      expect(result.topKeywords).toEqual([]);
      expect(result.topEntities).toEqual([]);
      expect(result.topAuthors).toEqual([]);
      expect(result.keyPoints).toEqual([]);
      expect(result.timelineEvents).toEqual([]);
    });

    it('should handle key points stored as already-parsed arrays', async () => {
      mockQueryRunner.query
        .mockResolvedValueOnce([{ resourceCount: '0', docCount: '0', noteCount: '0', datasetCount: '0', bibliographyCount: '0', entityCount: '0' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ resourceName: 'R1', keyPoints: ['Already', 'Parsed'] }])
        .mockResolvedValueOnce([]);

      const result = await service.getStats(1);
      expect(result.keyPoints).toEqual([
        { text: 'Already', source: 'R1' },
        { text: 'Parsed', source: 'R1' },
      ]);
    });

    it('should always release queryRunner even if queries succeed', async () => {
      // Setup minimal mock data
      for (let i = 0; i < 10; i++) {
        mockQueryRunner.query.mockResolvedValueOnce(i === 0 ? [{ resourceCount: '0', docCount: '0', noteCount: '0', datasetCount: '0', bibliographyCount: '0', entityCount: '0' }] : []);
      }
      await service.getStats(1);
      expect(mockQueryRunner.release).toHaveBeenCalledTimes(1);
    });
  });
});

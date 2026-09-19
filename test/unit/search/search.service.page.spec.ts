import { SearchService } from '../../../src/search/search.service';

// Only the page-augmentation matchers are exercised here. The heavy search
// machinery (globalSearch, searchBlocks, matchEntitiesInText) needs a database
// and has its own integration surface; these tests pin the pure composition of
// each matcher: which service it asks and what it does with the answer.
describe('SearchService page matchers', () => {
  let knowledge: { findAll: jest.Mock };
  let timeline: { findByProject: jest.Mock };
  let bibliography: { findByProject: jest.Mock; findAll: jest.Mock };
  let service: SearchService;

  beforeEach(() => {
    knowledge = { findAll: jest.fn().mockResolvedValue([]) };
    timeline = { findByProject: jest.fn().mockResolvedValue([]) };
    bibliography = {
      findByProject: jest.fn().mockResolvedValue([]),
      findAll: jest.fn().mockResolvedValue([]),
    };
    service = new SearchService(
      {} as any,
      {} as any,
      {} as any,
      undefined,
      undefined,
      undefined,
      knowledge as any,
      undefined,
      undefined,
      undefined,
      timeline as any,
      bibliography as any,
    );
  });

  describe('matchKnowledgeInText', () => {
    it('returns entries whose title appears in the text', async () => {
      knowledge.findAll.mockResolvedValue([
        { id: 1, title: 'Sistema inmune', summary: 'Resumen', tags: null },
        { id: 2, title: 'Otra cosa', summary: null, tags: null },
      ]);
      const matches = await service.matchKnowledgeInText(
        'El sistema inmune protege el cuerpo.',
      );
      expect(matches).toHaveLength(1);
      expect(matches[0]).toEqual({
        id: 1,
        title: 'Sistema inmune',
        summary: 'Resumen',
        matchedTerms: ['Sistema inmune'],
      });
    });

    it('returns nothing for empty text without asking the backend', async () => {
      expect(await service.matchKnowledgeInText('   ')).toEqual([]);
      expect(knowledge.findAll).not.toHaveBeenCalled();
    });
  });

  describe('matchTimelineInText', () => {
    it('matches an event date and reports its precision', async () => {
      timeline.findByProject.mockResolvedValue([
        {
          id: 7,
          name: 'Revolución',
          timelineData: [
            { id: 'e1', title: 'Toma de la Bastilla', date: '1789-07-14' },
          ],
        },
      ]);
      const matches = await service.matchTimelineInText(
        'La toma de la Bastilla ocurrió el 14 de julio de 1789.',
        3,
      );
      expect(timeline.findByProject).toHaveBeenCalledWith(3);
      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({
        timelineId: 7,
        timelineName: 'Revolución',
        eventId: 'e1',
        title: 'Toma de la Bastilla',
        date: '1789-07-14',
        matchedTerm: '14 de julio de 1789',
        precision: 'day',
      });
    });

    it('needs a project to look timelines up', async () => {
      expect(await service.matchTimelineInText('1789', undefined)).toEqual([]);
      expect(timeline.findByProject).not.toHaveBeenCalled();
    });
  });

  describe('matchBibliographyInText', () => {
    it('matches an inline author-year citation', async () => {
      bibliography.findByProject.mockResolvedValue([
        {
          id: 4,
          citeKey: 'garcia2024',
          title: 'Una historia',
          creators: [{ creatorType: 'author', lastName: 'García' }],
          year: '2024',
        },
      ]);
      const matches = await service.matchBibliographyInText(
        'Como dijo (García, 2024) en su libro.',
        2,
      );
      expect(bibliography.findByProject).toHaveBeenCalledWith(2);
      expect(matches).toHaveLength(1);
      expect(matches[0].id).toBe(4);
      expect(matches[0].matchedTerms).toContain('(García, 2024)');
      expect(matches[0].matchKinds).toContain('authorYear');
    });

    it('does not resolve numeric citations', async () => {
      bibliography.findByProject.mockResolvedValue([
        {
          id: 4,
          citeKey: 'garcia2024',
          title: 'Una historia',
          creators: [{ creatorType: 'author', lastName: 'García' }],
          year: '2024',
        },
      ]);
      expect(
        await service.matchBibliographyInText('según [3] y (12, 15)', 2),
      ).toEqual([]);
    });

    it('falls back to every entry when there is no project', async () => {
      bibliography.findAll.mockResolvedValue([]);
      await service.matchBibliographyInText('texto', undefined);
      expect(bibliography.findAll).toHaveBeenCalled();
      expect(bibliography.findByProject).not.toHaveBeenCalled();
    });
  });
});

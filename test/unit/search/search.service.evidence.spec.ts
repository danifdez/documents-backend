import { NotFoundException } from '@nestjs/common';
import { SearchService } from '../../../src/search/search.service';

describe('SearchService evidence search', () => {
  let project: { findOne: jest.Mock };
  let service: SearchService;

  beforeEach(() => {
    project = { findOne: jest.fn().mockResolvedValue({ id: 7 }) };
    service = new SearchService(
      {} as any,
      {} as any,
      {} as any,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      project as any,
    );
  });

  it('returns clean, project-scoped evidence with its provenance', async () => {
    jest.spyOn(service, 'globalSearch').mockResolvedValue([
      {
        id: 12,
        name: 'Evidence note',
        score: 0.8,
        collection: 'docs',
        highlightedContent: '<p>Evidence <strong>supports</strong> the claim.</p>',
      },
    ]);

    await expect(service.findEvidence('claim', 7, 3)).resolves.toEqual({
      projectId: 7,
      sources: [
        {
          collection: 'docs',
          id: 12,
          name: 'Evidence note',
          score: 0.8,
          excerpt: 'Evidence supports the claim.',
          retrieval: 'lexical',
          provenance: { projectId: 7, collection: 'docs', id: 12 },
        },
      ],
    });
    expect(project.findOne).toHaveBeenCalledWith(7);
    expect(service.globalSearch).toHaveBeenCalledWith('claim', 7);
  });

  it('recovers a project-scoped contradiction when the selected wording is absent', async () => {
    const search = jest.spyOn(service, 'globalSearch')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 12,
          name: 'Evidence note',
          score: 0.8,
          collection: 'docs',
          highlightedContent: '...El Reglamento se hizo <strong>aplicable</strong> el 2 de agosto de 2026, con excepciones.',
        },
      ]);

    await expect(service.findEvidence(
      'El Reglamento se hizo aplicable el 1 de agosto de 2024.', 7, 3,
    )).resolves.toEqual({
      projectId: 7,
      sources: [
        {
          collection: 'docs',
          id: 12,
          name: 'Evidence note',
          score: 0.8,
          excerpt: 'El Reglamento se hizo aplicable el 2 de agosto de 2026, con excepciones.',
          retrieval: 'lexical',
          provenance: { projectId: 7, collection: 'docs', id: 12 },
        },
      ],
    });
    expect(search).toHaveBeenNthCalledWith(
      1, 'El Reglamento se hizo aplicable el 1 de agosto de 2024.', 7,
    );
    expect(search).toHaveBeenNthCalledWith(2, 'aplicable', 7);
  });

  it('drops a truncated fallback fragment that cannot be highlighted in its source', async () => {
    jest.spyOn(service, 'globalSearch')
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        {
          id: 12,
          name: 'Evidence note',
          score: 0.8,
          collection: 'docs',
          highlightedContent: '...El Reglamento establece una sanción máxima de <strong>50 millones</strong> de euros...',
        },
      ]);

    await expect(service.findEvidence(
      'El Reglamento establece una sanción máxima de 50 millones de euros.', 7, 3,
    )).resolves.toEqual({
      projectId: 7,
      sources: [],
    });
  });

  it('does not search when the selected project no longer exists', async () => {
    project.findOne.mockResolvedValue(null);
    const search = jest.spyOn(service, 'globalSearch');

    await expect(service.findEvidence('claim', 7)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(search).not.toHaveBeenCalled();
  });
});

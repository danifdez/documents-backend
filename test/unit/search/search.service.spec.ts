import { SearchService } from '../../../src/search/search.service';
import type { SearchResultDto } from '../../../src/search/dto/search-result.dto';

describe('SearchService collections and blocks', () => {
  const collection = (rows: unknown[] = []) => ({
    globalSearch: jest.fn().mockResolvedValue(rows),
  });
  let db: { query: jest.Mock };
  let docs: ReturnType<typeof collection>;
  let resources: ReturnType<typeof collection>;
  let canvases: ReturnType<typeof collection>;
  let notes: ReturnType<typeof collection>;
  let events: ReturnType<typeof collection>;
  let knowledge: ReturnType<typeof collection>;
  let entities: ReturnType<typeof collection>;
  let datasets: ReturnType<typeof collection>;
  let projects: { search: jest.Mock; findOne: jest.Mock };
  let service: SearchService;

  beforeEach(() => {
    db = { query: jest.fn().mockResolvedValue([]) };
    docs = collection();
    resources = collection();
    canvases = collection();
    notes = collection();
    events = collection();
    knowledge = collection();
    entities = collection();
    datasets = collection();
    projects = {
      search: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({ id: 7 }),
    };
    service = new SearchService(
      db as any,
      docs as any,
      resources as any,
      canvases as any,
      notes as any,
      events as any,
      knowledge as any,
      entities as any,
      datasets as any,
      projects as any,
    );
  });

  it('ranks global matches with project hits and translated text', async () => {
    docs.globalSearch.mockResolvedValue([
      {
        d_id: 1,
        d_name: 'C++ notes',
        d_content: '<p>Readable C++</p>',
        score: '.95',
      },
    ]);
    resources.globalSearch.mockResolvedValue([
      {
        r_id: 2,
        r_name: 'Source',
        r_title: 'Guide',
        r_content: '',
        r_translated_content: '<p>A translation about c++</p>',
        score: '.9',
      },
      {
        r_id: 12,
        r_name: 'Original',
        r_content: '<p>Keep original</p>',
        r_translated_content: 'C++',
        score: '.4',
      },
    ]);
    canvases.globalSearch.mockResolvedValue([
      { c_id: 3, c_name: 'Draft', c_content: 'C++ diagram', score: '.5' },
    ]);
    notes.globalSearch.mockResolvedValue([
      { n_id: 4, n_content: 'Short note', score: 'invalid' },
    ]);
    events.globalSearch.mockResolvedValue([
      { e_id: 5, e_description: 'Workshop', score: '.3' },
    ]);
    knowledge.globalSearch.mockResolvedValue([
      { k_id: 6, k_summary: 'C++ summary', score: '.7' },
    ]);
    entities.globalSearch.mockResolvedValue([
      { e_id: 7, e_name: 'C++', e_description: 'Example', score: '.2' },
    ]);
    datasets.globalSearch.mockResolvedValue([
      { d_id: 8, d_name: 'Data', d_description: 'C++ usage', score: '.1' },
    ]);
    projects.search.mockResolvedValue([{ id: 9, name: 'C++ project' }]);

    const results = await service.globalSearch('C++');
    expect(
      results.map(({ id, collection, score }) => [id, collection, score]),
    ).toEqual([
      [1, 'docs', 0.95],
      [2, 'resources', 0.9],
      [6, 'knowledge', 0.7],
      [9, 'docs', 0.6],
      [3, 'canvases', 0.5],
      [12, 'resources', 0.4],
      [5, 'events', 0.3],
      [7, 'entities', 0.2],
      [8, 'datasets', 0.1],
      [4, 'notes', 0],
    ]);
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 1,
          highlightedName: '<strong>C++</strong> notes',
          highlightedContent: 'Readable <strong>C++</strong>',
        }),
        expect.objectContaining({
          id: 2,
          highlightedContent: 'A translation about <strong>c++</strong>',
        }),
        expect.objectContaining({
          id: 12,
          highlightedContent: 'Keep original',
        }),
        expect.objectContaining({
          id: 6,
          name: 'Untitled entry',
          highlightedContent: '<strong>C++</strong> summary',
        }),
        expect.objectContaining({
          id: 9,
          highlightedName: '<strong>C++</strong> project',
        }),
        expect.objectContaining({ id: 5, name: 'Untitled event' }),
        expect.objectContaining({ id: 4, name: 'Untitled note' }),
      ]),
    );
    expect(projects.search).toHaveBeenCalledWith('C++');
    expect(knowledge.globalSearch).toHaveBeenCalledWith('C++');
  });

  it('scopes queries and crops long highlights around literal text', async () => {
    const before = 'a'.repeat(80);
    const after = 'b'.repeat(80);
    docs.globalSearch.mockResolvedValue([
      {
        d_id: 1,
        d_name: 'Match',
        d_content: `<p>${before}[x]${after}</p>`,
        score: '1',
      },
      {
        d_id: 2,
        d_name: '[x] suffix',
        d_content: '<p>' + before + after + '</p>',
      },
    ]);
    notes.globalSearch.mockResolvedValue(null);

    await expect(service.globalSearch('[x]', 7)).resolves.toEqual([
      expect.objectContaining({
        id: 1,
        highlightedContent:
          '...' +
          'a'.repeat(50) +
          '<strong>[x]</strong>' +
          'b'.repeat(50) +
          '...',
      }),
      expect.objectContaining({
        id: 2,
        highlightedContent: before + 'b'.repeat(20) + '...',
      }),
    ]);
    for (const source of [
      docs,
      resources,
      canvases,
      notes,
      events,
      entities,
      datasets,
    ]) {
      expect(source.globalSearch).toHaveBeenCalledWith('[x]', 7);
    }
    expect(projects.search).not.toHaveBeenCalled();
    expect(knowledge.globalSearch).not.toHaveBeenCalled();
    await service.globalSearch(' ');
    expect(projects.search).not.toHaveBeenCalled();
  });

  it('matches localized entity terms once within the project/global visibility scope', async () => {
    const ada = {
      id: 1,
      name: 'Ada Lovelace',
      entity_type_name: 'Person',
      description: 'Mathematician',
      aliases: [{ value: 'Augusta Ada' }],
    };
    db.query.mockResolvedValue([
      ada,
      ada,
      { id: 2, name: 'Paris', translations: { es: 'París' } },
      { id: 3, name: 'Rome' },
    ]);

    await expect(
      service.matchEntitiesInText('Augusta Ada visited París.', 7),
    ).resolves.toEqual([
      {
        id: 1,
        name: 'Ada Lovelace',
        type: 'Person',
        description: 'Mathematician',
        matchedTerms: ['Augusta Ada'],
      },
      expect.objectContaining({
        id: 2,
        name: 'Paris',
        type: 'Unknown',
        matchedTerms: ['París'],
      }),
    ]);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('ep.project_id = $1'),
      [7],
    );
    await service.matchEntitiesInText('Rome');
    expect(db.query).toHaveBeenLastCalledWith(
      expect.stringContaining(' WHERE e.global = true'),
      [],
    );

    db.query.mockClear();
    await expect(service.matchEntitiesInText(' ', 7)).resolves.toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
    db.query.mockRejectedValue(new Error('database unavailable'));
    await expect(service.matchEntitiesInText('Rome', 7)).resolves.toEqual([]);
  });

  it('uses up to four keywords per block and returns the three best distinct hits', async () => {
    const hit = (
      id: number,
      score: number,
      collection: SearchResultDto['collection'] = 'docs',
    ): SearchResultDto => ({ id, name: 'Hit ' + id, score, collection });
    const first = hit(1, 0.8);
    const second = hit(2, 0.9);
    const third = hit(1, 0.7, 'resources');
    const search = jest
      .spyOn(service, 'globalSearch')
      .mockImplementation(async (keyword) => {
        if (keyword === 'transcription') throw new Error('temporary failure');
        if (keyword === 'electrochemistry') return [first, hit(3, 0.2)];
        if (keyword === 'notebook') return [first, second];
        return [third, hit(4, 0.4)];
      });

    await expect(
      service.searchBlocks(
        [
          { blockId: 'short', text: 'short' },
          {
            blockId: 'stopwords',
            text: 'which would make more than these about',
          },
          {
            blockId: 'article',
            text: 'Electrochemistry transcription notebook gel ',
          },
        ],
        7,
      ),
    ).resolves.toEqual([
      { blockId: 'article', results: [second, first, third] },
    ]);
    expect(search.mock.calls).toEqual([
      ['electrochemistry', 7],
      ['transcription', 7],
      ['notebook', 7],
      ['gel', 7],
    ]);
  });

  it('limits processing to 20 blocks and ignores text past the input limit', async () => {
    const search = jest.spyOn(service, 'globalSearch').mockResolvedValue([]);
    await expect(service.searchBlocks([])).resolves.toEqual([]);
    await expect(
      service.searchBlocks([
        { blockId: 'long', text: ' '.repeat(500) + 'Electrochemistry' },
        ...Array.from({ length: 19 }, (_, id) => ({
          blockId: String(id),
          text: '',
        })),
        {
          blockId: 'ignored',
          text: 'An electrochemistry notebook with examples',
        },
      ]),
    ).resolves.toEqual([]);
    expect(search).not.toHaveBeenCalled();
  });

  it('uses document and resource evidence and shortens long matching passages', async () => {
    const passage = 'Evidence phrase '.repeat(45).trim();
    docs.globalSearch.mockResolvedValue([
      {
        d_id: 1,
        d_name: '<i></i>',
        d_content: `<strong>${passage}</strong>`,
        score: '.9',
      },
    ]);
    resources.globalSearch.mockResolvedValue([
      {
        r_id: 2,
        r_name: '<p>Source</p>',
        r_content: 'Evidence phrase appears in this full sentence.',
        score: '.8',
      },
    ]);
    const search = jest.spyOn(service, 'globalSearch').mockResolvedValue([
      {
        id: 4,
        name: 'Note',
        collection: 'notes',
        score: 1,
        highlightedContent: '<strong>Excluded note content</strong>',
      },
      {
        id: 1,
        name: '<i></i>',
        collection: 'docs',
        score: 0.9,
        highlightedContent: `<strong>${passage}</strong>`,
      },
      {
        id: 2,
        name: '<p>Source</p>',
        collection: 'resources',
        score: 0.8,
        highlightedTitle:
          '<strong>Evidence</strong> appears in a full sentence.',
      },
    ]);
    const result = await service.findEvidence(' Evidence ', 7, 2);
    expect(search).toHaveBeenCalledWith('Evidence', 7);
    expect(result.sources).toEqual([
      expect.objectContaining({
        id: 1,
        name: 'docs 1',
        excerpt: passage.slice(0, 599).trimEnd() + '…',
      }),
      expect.objectContaining({
        id: 2,
        name: 'Source',
        excerpt: 'Evidence appears in a full sentence.',
      }),
    ]);
  });
});

import { AgeGraphService } from '../../../src/graph/age-graph.service';

describe('AgeGraphService', () => {
  it('replaces and verifies the exact extracted relationship graph', async () => {
    const manager = {
      query: jest.fn().mockImplementation(async (query: string) => {
        if (query.includes('RETURN s.entity_id AS subject_id')) {
          return [
            {
              subject_id: '1',
              subject: '"Ada"',
              subject_type: '"PERSON"',
              predicate: '"built"',
              confidence: '0.5',
              context: '"document"',
              project_id: '3',
              object_id: '2',
              object: '"Engine"',
              object_type: '"PRODUCT"',
            },
          ];
        }
        return [];
      }),
    };
    const service = new AgeGraphService({} as any);

    await expect(
      service.replaceExtractedRelationshipsVerified(
        7,
        3,
        [
          { id: 1, name: 'Ada', type: 'PERSON' },
          { id: 2, name: 'Engine', type: 'PRODUCT' },
        ],
        [
          {
            subject: 'Ada',
            predicate: 'built',
            object: 'Engine',
            confidence: 0.5,
            context: 'document',
          },
        ],
        manager as any,
      ),
    ).resolves.toEqual({
      relationshipCount: 1,
      relationshipsHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(manager.query).toHaveBeenCalledWith("LOAD 'age'");
    expect(manager.query).toHaveBeenCalledWith(
      'SET search_path = ag_catalog, "$user", public',
    );
  });

  it('rejects a graph that does not match the intended relationships', async () => {
    const manager = {
      query: jest
        .fn()
        .mockImplementation(async (query: string) =>
          query.includes('RETURN s.entity_id AS subject_id') ? [] : [],
        ),
    };
    const service = new AgeGraphService({} as any);

    await expect(
      service.replaceExtractedRelationshipsVerified(
        7,
        null,
        [
          { id: 1, name: 'Ada', type: 'PERSON' },
          { id: 2, name: 'Engine', type: 'PRODUCT' },
        ],
        [
          {
            subject: 'Ada',
            predicate: 'built',
            object: 'Engine',
            confidence: 1,
          },
        ],
        manager as any,
      ),
    ).rejects.toThrow('relationship_graph_effect_not_verified');
  });
});

describe('AgeGraphService query and write lifecycle', () => {
  let runner: {
    connect: jest.Mock;
    query: jest.Mock;
    release: jest.Mock;
    startTransaction: jest.Mock;
    commitTransaction: jest.Mock;
    rollbackTransaction: jest.Mock;
  };
  let createQueryRunner: jest.Mock;
  let service: AgeGraphService;
  const ada = { id: 1, name: 'Ada', type: 'PERSON' };
  const engine = { id: 2, name: 'Engine', type: 'OBJECT' };

  beforeEach(() => {
    runner = {
      connect: jest.fn(),
      query: jest.fn().mockResolvedValue([]),
      release: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
    };
    createQueryRunner = jest.fn().mockReturnValue(runner);
    service = new AgeGraphService({ createQueryRunner } as any);
  });

  function setRows(rows: object[]) {
    runner.query.mockImplementation(async (sql) =>
      sql.includes('SELECT * FROM ag_catalog.cypher') ? rows : [],
    );
  }

  const queries = (runnerQuery: jest.Mock) =>
    runnerQuery.mock.calls.filter(([sql]) =>
      sql.includes('SELECT * FROM ag_catalog.cypher'),
    );

  it('decodes AGE rows, deduplicates nodes and clamps the query limit', async () => {
    setRows([
      {
        source_id: '1',
        source_name: '"Ada"',
        source_type: '"PERSON"',
        target_id: 2,
        target_name: '"Engine"',
        target_type: '"OBJECT"',
        predicate: '"built"',
        confidence: '0.8',
        resource_id: '7',
      },
      {
        source_id: 1,
        source_name: 'Ada',
        source_type: 'PERSON',
        target_id: '3',
        target_name: 'London',
        target_type: null,
        predicate: 'visited',
        confidence: null,
        resource_id: '8',
      },
    ]);
    await expect(service.queryAll(10000)).resolves.toEqual({
      entities: [ada, engine, { id: 3, name: 'London', type: '' }],
      relationships: [
        {
          source: 1,
          target: 2,
          predicate: 'built',
          confidence: 0.8,
          resource_id: 7,
        },
        {
          source: 1,
          target: 3,
          predicate: 'visited',
          confidence: 1,
          resource_id: 8,
        },
      ],
    });
    expect(queries(runner.query)).toEqual([
      [expect.stringContaining('LIMIT 1000'), ['{}']],
    ]);
    expect(runner.release).toHaveBeenCalledTimes(1);
  });

  it('binds resource and project values to the graph queries', async () => {
    await service.queryByResource(7, -100);
    await service.queryByProject(3, [7, 9], Number.NaN);
    await service.queryByProject(3, []);
    const [resource, filtered, project] = queries(runner.query);
    expect(resource).toEqual([
      expect.stringContaining('LIMIT 1'),
      [JSON.stringify({ resource_id: 7 })],
    ]);
    expect(filtered).toEqual([
      expect.stringContaining('r.resource_id IN $resource_ids'),
      [JSON.stringify({ project_id: 3, resource_ids: [7, 9] })],
    ]);
    expect(filtered[0]).toContain('LIMIT 200');
    expect(project[0]).not.toContain('r.resource_id IN');
    expect(project[1]).toEqual([JSON.stringify({ project_id: 3 })]);
  });

  it('skips empty neighborhoods and finds entity names in project text', async () => {
    await expect(service.queryNeighborhood([])).resolves.toEqual({
      entities: [],
      relationships: [],
    });
    await expect(service.queryNeighborhoodForText('Ada')).resolves.toEqual({
      entities: [],
      relationships: [],
    });
    await expect(service.queryNeighborhoodForText(' ', 3)).resolves.toEqual({
      entities: [],
      relationships: [],
    });
    expect(createQueryRunner).not.toHaveBeenCalled();
    runner.query.mockImplementation(async (sql) => {
      if (sql.includes('DISTINCT e.name'))
        return [
          { name: '"Ada"' },
          { name: 'X' },
          { name: null },
          { name: 'Unmatched' },
        ];
      if (sql.includes('UNWIND'))
        return [
          {
            source: '"Ada"',
            target: '"Engine"',
            predicate: '"built"',
            confidence: null,
          },
        ];
      return [];
    });

    const expected = {
      entities: [
        { id: 'Ada', name: 'Ada', type: '' },
        { id: 'Engine', name: 'Engine', type: '' },
      ],
      relationships: [
        { source: 'Ada', target: 'Engine', predicate: 'built', confidence: 1 },
      ],
    };
    await expect(
      service.queryNeighborhoodForText('Notes on ADA', 3),
    ).resolves.toEqual(expected);
    await expect(
      service.queryNeighborhood(['Ada'], undefined, 20, Number.NaN),
    ).resolves.toEqual(expected);
    const [, project, global] = queries(runner.query);
    expect(project).toEqual([
      expect.stringContaining(':REL*1..2 {project_id: $project_id}'),
      [JSON.stringify({ names: ['Ada'], project_id: 3 })],
    ]);
    expect(global).toEqual([
      expect.stringContaining('[:REL*1..5]'),
      [JSON.stringify({ names: ['Ada'] })],
    ]);
    expect(global[0]).toContain('LIMIT 50');
    expect(runner.release).toHaveBeenCalledTimes(3);
  });

  it('persists edits, deletes scoped edges and commits each mutation', async () => {
    await service.createRelationship(ada, 'built', engine, 7);
    await service.updateRelationship(1, 'built', 2, 'designed', 7);
    await service.deleteRelationship(1, 'designed', 2, 7);
    await service.deleteByResource(8);
    const result = queries(runner.query);
    expect(result.slice(0, 2).map(([, [bound]]) => JSON.parse(bound))).toEqual([
      { entity_id: 1, name: 'Ada', entity_type: 'PERSON' },
      { entity_id: 2, name: 'Engine', entity_type: 'OBJECT' },
    ]);
    expect(result[2]).toEqual([
      expect.stringContaining('MERGE (s)-[r:REL'),
      [
        JSON.stringify({
          subject_id: 1,
          predicate: 'built',
          object_id: 2,
          resource_id: 7,
          project_id: null,
          confidence: 1,
          context: '',
        }),
      ],
    ]);
    expect(result[3][0]).toContain('SET r.predicate = $new_predicate');
    expect(JSON.parse(result[3][1][0])).toMatchObject({
      new_predicate: 'designed',
      resource_id: 7,
    });
    expect(result[4][0]).toContain('DELETE r');
    expect(result[5][1]).toEqual([JSON.stringify({ resource_id: 8 })]);
    expect(runner.startTransaction).toHaveBeenCalledTimes(4);
    expect(runner.commitTransaction).toHaveBeenCalledTimes(4);
    expect(runner.rollbackTransaction).not.toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalledTimes(4);
  });

  it('releases the connection when setup fails and rolls back a failed write', async () => {
    runner.query.mockRejectedValueOnce(new Error('AGE unavailable'));
    await expect(service.queryAll()).rejects.toThrow('AGE unavailable');
    expect(runner.release).toHaveBeenCalledTimes(1);
    runner.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('write failed'));
    await expect(service.deleteByResource(7)).rejects.toThrow('write failed');
    expect(runner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(runner.commitTransaction).not.toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalledTimes(2);
  });
});

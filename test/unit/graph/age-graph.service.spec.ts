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

import { VectorStoreService } from '../../../src/vector/vector-store.service';

describe('VectorStoreService', () => {
  const embedding = [1, ...Array(383).fill(0)];
  let manager: { query: jest.Mock };
  let dataSource: { query: jest.Mock; transaction: jest.Mock };
  let service: VectorStoreService;

  beforeEach(() => {
    manager = { query: jest.fn().mockResolvedValue([]) };
    dataSource = {
      query: jest.fn().mockResolvedValue([]),
      transaction: jest.fn(async (work) => work(manager)),
    };
    service = new VectorStoreService(dataSource as any);
  });

  it('serializes stored candidates as an attempt-scoped artifact', async () => {
    dataSource.query.mockResolvedValue([
      {
        id: 'one',
        embedding: `[${embedding.join(',')}]`,
        payload: { text: 'A' },
      },
    ]);

    const candidates = await service.workspaceCandidates(2);
    const artifact = service.vectorCandidatesArtifact(candidates);

    expect(candidates[0].embedding).toHaveLength(384);
    expect(dataSource.query.mock.calls[0][0]).toContain(
      "source_type IN ('resource', 'doc', 'knowledge')",
    );
    expect(artifact.role).toBe('vector_candidates');
    expect(JSON.parse(artifact.body.toString('utf8'))).toEqual({ candidates });
  });

  it('rejects malformed model output before writing', async () => {
    await expect(
      service.replaceWorkspaceSourceVerified(
        'resource',
        'resource_7',
        null,
        [{ id: 'bad', embedding: [1], payload: {} }],
        manager as any,
      ),
    ).rejects.toThrow('384 finite values');
    expect(manager.query).not.toHaveBeenCalled();
  });

  it('atomically replaces and verifies workspace vectors', async () => {
    manager.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ point_count: 1, matches: true }]);

    await expect(
      service.replaceWorkspaceSourceVerified(
        'knowledge',
        'knowledge_4',
        null,
        [
          {
            id: 'knowledge_4:1',
            embedding,
            payload: { text: 'Verified knowledge' },
          },
        ],
        manager as any,
      ),
    ).resolves.toEqual({
      pointCount: 1,
      pointIds: ['knowledge_4:1'],
    });

    expect(manager.query.mock.calls[2][0]).toContain(
      'SELECT * FROM actual EXCEPT SELECT * FROM expected',
    );
    expect(manager.query.mock.calls[2][1]).toEqual([
      'knowledge_4',
      'knowledge',
      null,
      expect.any(String),
    ]);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('atomically replaces and verifies vectors for an assistant folder', async () => {
    manager.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ point_count: 1, matches: true }]);

    await expect(
      service.replaceIndexedFileVerified(
        9,
        'assistant:2',
        [
          {
            id: 'indexed_file_9:1',
            embedding,
            payload: { text: 'Workspace context' },
          },
        ],
        manager as any,
      ),
    ).resolves.toEqual({
      pointCount: 1,
      pointIds: ['indexed_file_9:1'],
    });

    expect(manager.query.mock.calls[1][0]).toContain(
      'INSERT INTO indexed_file_chunks',
    );
    expect(manager.query.mock.calls[2][0]).toContain(
      'SELECT * FROM actual EXCEPT SELECT * FROM expected',
    );
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });
});

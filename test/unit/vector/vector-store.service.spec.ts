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

  it('replaces workspace vectors in one transaction', async () => {
    await service.replaceWorkspaceSource('resource', 'resource_7', 3, [
      {
        id: 'resource_7:1',
        embedding,
        payload: { text: 'Ada', source_id: 'forged', project_id: 99 },
      },
    ]);

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(manager.query).toHaveBeenNthCalledWith(
      1,
      'DELETE FROM rag_chunks WHERE source_id = $1',
      ['resource_7'],
    );
    expect(manager.query.mock.calls[1][0]).toContain('INSERT INTO rag_chunks');
    expect(manager.query.mock.calls[1][1]).toEqual([
      'resource_7:1',
      expect.stringMatching(/^\[1,0,/),
      'resource',
      'resource_7',
      '3',
      '{"text":"Ada","source_id":"resource_7","project_id":3,"source_type":"resource"}',
    ]);
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
      service.replaceWorkspaceSource('resource', 'resource_7', null, [
        { id: 'bad', embedding: [1], payload: {} },
      ]),
    ).rejects.toThrow('384 finite values');
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });
});

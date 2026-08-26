import { IngestContentProcessor } from '../../../src/execution-processor/processors/ingest-content-processor'; // eslint-disable-line max-len
import { IndexedFileIngestProcessor } from '../../../src/execution-processor/processors/indexed-file-ingest-processor'; // eslint-disable-line max-len
import { VectorSearchProcessor } from '../../../src/execution-processor/processors/vector-search-processor'; // eslint-disable-line max-len
import { ExecutionEntity } from '../../../src/execution/execution.entity';

const execution = (
  taskType: string,
  payload: Record<string, unknown>,
  result: Record<string, unknown>,
) => ({ taskType, payload, result }) as ExecutionEntity;

describe('vector domain finalizers', () => {
  it('persists workspace points before marking a resource ready', async () => {
    const resource = { id: 7, status: 'ingesting' };
    const transactionalRepository = {
      findOne: jest.fn().mockResolvedValue(resource),
      save: jest.fn().mockResolvedValue(resource),
      findOneBy: jest.fn().mockImplementation(async () => resource),
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue(transactionalRepository),
    };
    const vectorStore = {
      replaceWorkspaceSourceVerified: jest.fn().mockResolvedValue({
        pointCount: 1,
        pointIds: ['resource_7:1'],
      }),
    };
    const artifacts = {
      readOutputJson: jest.fn().mockResolvedValue([{ points: [] }]),
    };
    const points = [{ id: 'resource_7:1', embedding: [], payload: {} }];
    artifacts.readOutputJson.mockResolvedValue([{ points }]);
    const effectJournal = {
      runVerified: jest.fn(async (_input, callback) => ({
        applied: true,
        observation: await callback(manager),
      })),
    };
    const processor = new IngestContentProcessor(
      vectorStore as any,
      artifacts as any,
      effectJournal as any,
    );

    const ingestExecution = execution(
      'ingest-content',
      { resourceId: 7, projectId: 3 },
      { pointCount: 1, chunks: 1 },
    );
    ingestExecution.executionId = '018f1d8a-54d7-7d63-a1ee-5e9a6adca706';
    await expect(processor.process(ingestExecution)).resolves.toEqual(
      expect.objectContaining({ success: true }),
    );
    expect(vectorStore.replaceWorkspaceSourceVerified).toHaveBeenCalledWith(
      'resource',
      'resource_7',
      3,
      points,
      manager,
    );
    expect(resource.status).toBe('ready');
    expect(effectJournal.runVerified).toHaveBeenCalledWith(
      expect.objectContaining({
        effectKey: 'ingest-content:resource_7',
        effectType: 'workspace_vectors_replace',
      }),
      expect.any(Function),
    );
  });

  it('persists indexed-file points only for the current checksum', async () => {
    const file = {
      id: 9,
      ownerType: 'agent',
      ownerId: 5,
      checksum: 'current',
      embeddingId: null,
    };
    const repository = {
      findOne: jest.fn().mockResolvedValue(file),
      save: jest.fn().mockResolvedValue(file),
    };
    const vectorStore = {
      replaceIndexedFileVerified: jest.fn().mockResolvedValue({
        pointCount: 1,
        pointIds: ['indexed_file_9:1'],
      }),
    };
    const points = [{ id: 'indexed_file_9:1', embedding: [], payload: {} }];
    const artifacts = {
      readOutputJson: jest.fn().mockResolvedValue([{ points }]),
    };
    const transactionalRepository = {
      findOne: jest.fn().mockResolvedValue(file),
      save: jest.fn().mockResolvedValue(file),
      findOneBy: jest.fn().mockImplementation(async () => file),
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue(transactionalRepository),
    };
    const effectJournal = {
      runVerified: jest.fn(async (_input, callback) => ({
        applied: true,
        observation: await callback(manager),
      })),
    };
    const processor = new IndexedFileIngestProcessor(
      repository as any,
      vectorStore as any,
      artifacts as any,
      effectJournal as any,
    );

    const ingestExecution = execution(
      'indexed-file-ingest',
      { indexedFileId: 9, checksum: 'current' },
      { chunks: 1, pointCount: 1 },
    );
    ingestExecution.executionId = '018f1d8a-54d7-7d63-a1ee-5e9a6adca703';
    await processor.process(ingestExecution);
    expect(vectorStore.replaceIndexedFileVerified).toHaveBeenCalledWith(
      9,
      'agent:5',
      points,
      manager,
    );
    expect(file.embeddingId).toBe('indexed_file_9');
    expect(effectJournal.runVerified).toHaveBeenCalledWith(
      expect.objectContaining({
        effectKey: 'indexed-file-ingest:9',
        effectType: 'indexed_file_vectors_replace',
      }),
      expect.any(Function),
    );
  });

  it('requires a structured result for vector searches', async () => {
    const files = { find: jest.fn().mockResolvedValue([]) };
    const processor = new VectorSearchProcessor(files as any);
    await expect(
      processor.process(
        execution(
          'indexed-file-search',
          { ownerType: 'assistant', ownerId: 2 },
          { results: [] },
        ),
      ),
    ).resolves.toEqual({ success: true, resultCount: 0 });
    await expect(
      processor.process(execution('indexed-file-search', {}, {})),
    ).rejects.toThrow('result requires results');
  });

  it('rejects indexed-file hits outside the execution owner scope', async () => {
    const processor = new VectorSearchProcessor({
      find: jest.fn().mockResolvedValue([]),
    } as any);

    await expect(
      processor.process(
        execution(
          'indexed-file-search',
          { ownerType: 'agent', ownerId: 2 },
          { results: [{ indexedFileId: 7, score: 0.8 }] },
        ),
      ),
    ).rejects.toThrow('outside its owner scope');
  });
});

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
    const resourceService = { update: jest.fn().mockResolvedValue(undefined) };
    const vectorStore = {
      replaceWorkspaceSource: jest.fn().mockResolvedValue(undefined),
    };
    const artifacts = {
      readOutputJson: jest.fn().mockResolvedValue([{ points: [] }]),
    };
    const points = [{ id: 'resource_7:1', embedding: [], payload: {} }];
    artifacts.readOutputJson.mockResolvedValue([{ points }]);
    const processor = new IngestContentProcessor(
      resourceService as any,
      vectorStore as any,
      artifacts as any,
    );

    await expect(
      processor.process(
        execution(
          'ingest-content',
          { resourceId: 7, projectId: 3 },
          { pointCount: 1, chunks: 1 },
        ),
      ),
    ).resolves.toEqual(expect.objectContaining({ success: true }));
    expect(vectorStore.replaceWorkspaceSource).toHaveBeenCalledWith(
      'resource',
      'resource_7',
      3,
      points,
    );
    expect(resourceService.update).toHaveBeenCalledWith(7, {
      status: 'ready',
    });
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
      replaceIndexedFile: jest.fn().mockResolvedValue(undefined),
    };
    const points = [{ id: 'indexed_file_9:1', embedding: [], payload: {} }];
    const artifacts = {
      readOutputJson: jest.fn().mockResolvedValue([{ points }]),
    };
    const processor = new IndexedFileIngestProcessor(
      repository as any,
      vectorStore as any,
      artifacts as any,
    );

    await processor.process(
      execution(
        'indexed-file-ingest',
        { indexedFileId: 9, checksum: 'current' },
        { chunks: 1, pointCount: 1 },
      ),
    );
    expect(vectorStore.replaceIndexedFile).toHaveBeenCalledWith(
      9,
      'agent:5',
      points,
    );
    expect(file.embeddingId).toBe('indexed_file_9');
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

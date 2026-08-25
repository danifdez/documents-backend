import { DatasetExtractionService } from '../../../src/dataset/dataset-extraction.service';

describe('DatasetExtractionService', () => {
  it('creates column proposals as inference assignments', async () => {
    const resourceService = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 7, title: 'Source', name: 'source' }),
      getContentById: jest.fn().mockResolvedValue('<p>Readable content</p>'),
    };
    const executionService = {
      createInference: jest
        .fn()
        .mockResolvedValue({ executionId: 'execution-id' }),
    };
    const service = new DatasetExtractionService(
      {} as any,
      {} as any,
      resourceService as any,
      executionService as any,
    );

    await expect(service.proposeColumns([7], 3)).resolves.toEqual({
      executionId: 'execution-id',
    });
    expect(executionService.createInference).toHaveBeenCalledWith(
      'dataset.propose-columns',
      expect.any(String),
      {
        projectId: 3,
        resources: [
          {
            id: 7,
            title: 'Source',
            excerpt: '<p>Readable content</p>',
          },
        ],
      },
    );
  });

  it('creates row extraction as inference with failure reconciliation', async () => {
    const recordRepository = {};
    const resourceService = {
      getContentById: jest.fn().mockResolvedValue('Readable content'),
    };
    const executionService = {
      createInference: jest
        .fn()
        .mockResolvedValue({ executionId: 'execution-id' }),
    };
    const service = new DatasetExtractionService(
      {} as any,
      recordRepository as any,
      resourceService as any,
      executionService as any,
    );

    await expect(
      (service as any).enqueueExtractionExecution(
        {
          id: 3,
          schema: [{ key: 'name', description: 'Person name' }],
          extractionConfig: { model: 'test-model' },
        },
        { id: 5 },
        {
          id: 7,
          mimeType: 'text/plain',
          title: 'Source',
          name: 'source.txt',
        },
        ['name'],
        11,
      ),
    ).resolves.toEqual({ executionId: 'execution-id' });
    expect(executionService.createInference).toHaveBeenCalledWith(
      'dataset.extract-row',
      expect.any(String),
      expect.objectContaining({
        datasetId: 3,
        recordId: 5,
        resourceId: 7,
        documentText: 'Readable content',
      }),
      { finalizeOnFailure: true },
    );
  });

  it('stores a canonical step failure on the dataset row', async () => {
    const record = {
      id: 5,
      dataset: { id: 3 },
      extractionStatus: 'in_progress',
      extractionError: null,
    };
    const recordRepository = {
      findOne: jest.fn().mockResolvedValue(record),
      save: jest.fn(async (value) => value),
    };
    const service = new DatasetExtractionService(
      {} as any,
      recordRepository as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.markExtractionFailed(5, 'Model failed'),
    ).resolves.toEqual({ datasetId: 3, status: 'failed' });
    expect(record).toEqual(
      expect.objectContaining({
        extractionStatus: 'failed',
        extractionError: 'Model failed',
      }),
    );
    expect(recordRepository.save).toHaveBeenCalledWith(record);
  });
});

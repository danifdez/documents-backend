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

    await expect(service.proposeColumns([7], '42', 3)).resolves.toEqual({
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
      { ownerPrincipal: '42' },
    );
  });

  it('creates row extraction as a map-reduce workflow', async () => {
    const recordRepository = {};
    const resourceService = {
      getContentById: jest.fn().mockResolvedValue('Readable content'),
    };
    const executionService = {
      create: jest.fn().mockResolvedValue({ executionId: 'execution-id' }),
    };
    const service = new DatasetExtractionService(
      {} as any,
      recordRepository as any,
      resourceService as any,
      executionService as any,
    );

    const enqueue = (mimeType: string) =>
      (service as any).enqueueExtractionExecution(
        {
          id: 3,
          schema: [{ key: 'name', description: 'Person name' }],
          extractionConfig: { model: 'test-model' },
        },
        { id: 5 },
        {
          id: 7,
          mimeType,
          title: 'Source',
          name: 'source.txt',
        },
        ['name'],
        11,
        '42',
      );
    await expect(enqueue('Text/HTML; charset=utf-8')).resolves.toEqual({
      executionId: 'execution-id',
    });
    const [, , payload, { steps }] = executionService.create.mock.calls[0];
    expect(payload.sourcePagination).toBe('unpaginated');
    expect(steps[0].work.payload.sourcePagination).toBe('unpaginated');
    expect(executionService.create).toHaveBeenCalledWith(
      'dataset.extract-row',
      expect.any(String),
      expect.objectContaining({
        datasetId: 3,
        recordId: 5,
        resourceId: 7,
        documentText: 'Readable content',
      }),
      {
        ownerPrincipal: '42',
        steps: expect.arrayContaining([
          expect.objectContaining({
            work: expect.objectContaining({
              taskType: 'dataset.extract-row-map',
            }),
          }),
          expect.objectContaining({
            work: expect.objectContaining({
              taskType: 'dataset.extract-row-reduce',
            }),
          }),
        ]),
      },
    );

    await enqueue('application/pdf');
    const [, , pdfPayload, pdfOptions] = executionService.create.mock.calls[1];
    expect(pdfPayload).not.toHaveProperty('sourcePagination');
    expect(pdfOptions.steps[0].work.payload).not.toHaveProperty(
      'sourcePagination',
    );
  });
});

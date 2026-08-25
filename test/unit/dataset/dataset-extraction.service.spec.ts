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
});

import { BadRequestException } from '@nestjs/common';
import { DatasetAnalysisService } from '../../../src/dataset/dataset-analysis.service';

describe('DatasetAnalysisService', () => {
  const sourceDataset = {
    id: 1,
    schema: [
      {
        key: 'category_id',
        name: 'Category',
        type: 'number',
        required: false,
        linkedDatasetId: 2,
        linkedDisplayField: 'name',
      },
    ],
  };
  const sourceRecords = [{ id: 10, data: { category_id: 20 } }];
  const linkedRecords = [{ id: 20, data: { name: 'Research' } }];

  function setup() {
    const datasetRepository = {
      find: jest.fn().mockResolvedValue([sourceDataset]),
    };
    const recordRepository = {
      find: jest.fn(async ({ where }: any) =>
        where.dataset.id === 1 ? sourceRecords : linkedRecords,
      ),
    };
    const executionService = {
      createCode: jest.fn().mockResolvedValue({ executionId: 'execution-id' }),
    };
    const service = new DatasetAnalysisService(
      datasetRepository as any,
      recordRepository as any,
      executionService as any,
    );
    return { service, executionService };
  }

  it('freezes records and linked labels into an input artifact', async () => {
    const { service, executionService } = setup();

    await expect(
      service.createExecution('distribution', [1], { field: 'category_id' }),
    ).resolves.toEqual({ executionId: 'execution-id' });

    const call = executionService.createCode.mock.calls[0];
    expect(call.slice(0, 3)).toEqual([
      'distribution',
      expect.any(String),
      { datasetId: 1, params: { field: 'category_id' } },
    ]);
    const artifact = call[3].inputArtifacts[0];
    expect(artifact).toMatchObject({
      role: 'datasets',
      kind: 'dataset_snapshot',
      mediaType: 'application/json',
    });
    expect(JSON.parse(artifact.body.toString())).toEqual({
      schemaVersion: 'dataset-analysis-input/1',
      datasets: [
        {
          datasetId: 1,
          schema: [
            expect.objectContaining({
              key: 'category_id',
              linkedLabels: { '20': 'Research' },
            }),
          ],
          records: sourceRecords,
        },
      ],
    });
  });

  it('rejects operations outside the dataset analysis allowlist', async () => {
    const { service, executionService } = setup();

    await expect(
      service.createExecution('delete-vectors', [1], {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(executionService.createCode).not.toHaveBeenCalled();
  });
});

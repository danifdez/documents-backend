// eslint-disable-next-line max-len
import { DatasetStatsProcessor } from '../../../src/execution-processor/processors/dataset-stats-processor';

describe('DatasetStatsProcessor', () => {
  const processor = new DatasetStatsProcessor();

  it('accepts a canonical dataset analysis result', async () => {
    await expect(
      processor.process({
        executionId: 'execution-id',
        taskType: 'distribution',
        payload: { datasetId: 7 },
        result: { chartType: 'bar', chartData: { labels: [], values: [] } },
      } as any),
    ).resolves.toMatchObject({
      success: true,
      publication: {
        payload: { type: 'distribution', datasetId: 7 },
      },
    });
  });

  it('rejects a missing result projection', async () => {
    await expect(
      processor.process({
        taskType: 'distribution',
        payload: { datasetId: 7 },
        result: null,
      } as any),
    ).resolves.toEqual({
      success: false,
      reason: 'invalid_dataset_analysis_result',
    });
  });
});

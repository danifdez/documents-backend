// eslint-disable-next-line max-len
import { DatasetProposeColumnsProcessor } from '../../../src/execution-processor/processors/dataset-propose-columns-processor';
import { ExecutionEntity } from '../../../src/execution/execution.entity';

describe('DatasetProposeColumnsProcessor', () => {
  const processor = new DatasetProposeColumnsProcessor();

  it('accepts a non-empty canonical column proposal', async () => {
    await expect(
      processor.process({ result: { columns: [{ key: 'title' }] } } as any),
    ).resolves.toEqual({ success: true });
  });

  it('rejects an empty proposal', async () => {
    await expect(
      processor.process({ result: { columns: [] } } as ExecutionEntity),
    ).resolves.toEqual({
      success: false,
      reason: 'invalid_column_proposal',
    });
  });
});

import { DataSourceSyncProcessor } from '../../../src/execution-processor/processors/data-source-sync-processor'; // eslint-disable-line max-len
import { ExecutionEntity } from '../../../src/execution/execution.entity';

describe('DataSourceSyncProcessor', () => {
  it('prepares external data before journaling its verified application', async () => {
    const prepared = {
      dataSourceId: 4,
      sourceIdentityHash: `sha256:${'a'.repeat(64)}`,
      records: [{ value: 3.5 }],
      schema: [
        { key: 'value', name: 'value', type: 'number', required: false },
      ],
      error: null,
    };
    const manager = {};
    const syncService = {
      prepareSync: jest.fn().mockResolvedValue(prepared),
      applyPreparedSync: jest.fn().mockResolvedValue({
        status: 'success',
        syncLogId: 8,
        observation: { dataSourceId: 4, recordsFetched: 1 },
      }),
    };
    const effectJournal = {
      getVerifiedObservation: jest.fn().mockResolvedValue(null),
      runVerified: jest.fn(async (_input, callback) => ({
        applied: true,
        observation: await callback(manager),
      })),
    };
    const processor = new DataSourceSyncProcessor(
      syncService as any,
      effectJournal as any,
    );
    const execution = {
      executionId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
      payload: { dataSourceId: 4 },
    } as ExecutionEntity;

    await expect(processor.process(execution)).resolves.toEqual({
      success: true,
      syncLogId: 8,
    });
    expect(syncService.prepareSync.mock.invocationCallOrder[0]).toBeLessThan(
      effectJournal.runVerified.mock.invocationCallOrder[0],
    );
    expect(syncService.applyPreparedSync).toHaveBeenCalledWith(
      prepared,
      manager,
    );
    expect(effectJournal.runVerified).toHaveBeenCalledWith(
      expect.objectContaining({
        effectKey: 'data-source-sync:4',
        effectType: 'data_source_dataset_sync',
      }),
      expect.any(Function),
    );
  });

  it('reuses a verified observation without fetching the provider again', async () => {
    const syncService = {
      prepareSync: jest.fn(),
      applyPreparedSync: jest.fn(),
    };
    const effectJournal = {
      getVerifiedObservation: jest.fn().mockResolvedValue({
        status: 'success',
        syncLogId: 8,
      }),
      runVerified: jest.fn(),
    };
    const processor = new DataSourceSyncProcessor(
      syncService as any,
      effectJournal as any,
    );
    const execution = {
      executionId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
      payload: { dataSourceId: 4 },
    } as ExecutionEntity;

    await expect(processor.process(execution)).resolves.toEqual({
      success: true,
      syncLogId: 8,
    });
    expect(syncService.prepareSync).not.toHaveBeenCalled();
    expect(effectJournal.runVerified).not.toHaveBeenCalled();
  });
});

import { DataSourceSyncService } from '../../../src/data-source/data-source-sync.service'; // eslint-disable-line max-len
import { DataSourceEntity } from '../../../src/data-source/data-source.entity';
import { DataSourceSyncLogEntity } from '../../../src/data-source/data-source-sync-log.entity'; // eslint-disable-line max-len

describe('DataSourceSyncService', () => {
  const createSource = () => ({
    id: 4,
    name: 'Remote data',
    description: null,
    providerType: 'missing',
    config: {},
    schemaMapping: null,
    syncStrategy: 'full',
    incrementalKey: null,
    dataset: null,
    project: null,
    rateLimitRpm: null,
    lastSyncAt: null,
    lastSyncStatus: null,
    lastSyncError: null,
    lastSyncRecordCount: null,
  });

  it('queues manual synchronization through the execution control plane', async () => {
    const source = createSource();
    const dataSources = {
      findOne: jest.fn().mockResolvedValue(source),
    };
    const executions = {
      create: jest.fn().mockResolvedValue({ executionId: 'execution-1' }),
    };
    const service = new DataSourceSyncService(
      { getProvider: jest.fn() } as any,
      dataSources as any,
      {} as any,
      executions as any,
    );

    await expect(service.syncDataSource(4)).resolves.toEqual({
      executionId: 'execution-1',
    });
    expect(executions.create).toHaveBeenCalledWith(
      'data-source-sync',
      'normal',
      { dataSourceId: 4 },
    );
  });

  it('persists and verifies provider failures with the supplied manager', async () => {
    const source = createSource();
    const dataSources = {
      findOne: jest.fn().mockResolvedValue(source),
      getDecryptedCredentials: jest.fn(),
    };
    const service = new DataSourceSyncService(
      { getProvider: jest.fn().mockReturnValue(undefined) } as any,
      dataSources as any,
      {} as any,
      {} as any,
    );
    const prepared = await service.prepareSync(4);
    const sourceRepository = {
      findOne: jest.fn().mockImplementation(async () => source),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const log = {
      id: 9,
      status: 'failed',
      recordsFetched: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      errorMessage: prepared.error,
    };
    const logRepository = {
      create: jest.fn().mockImplementation((value) => ({ ...value, id: 9 })),
      save: jest.fn().mockImplementation(async (value) => value),
      findOneBy: jest.fn().mockImplementation(async () => log),
    };
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity === DataSourceEntity) return sourceRepository;
        if (entity === DataSourceSyncLogEntity) return logRepository;
        throw new Error(`Unexpected repository ${entity.name}`);
      }),
    };

    await expect(
      service.applyPreparedSync(prepared, manager as any),
    ).resolves.toEqual(
      expect.objectContaining({ status: 'failed', syncLogId: 9 }),
    );
    expect(source.lastSyncStatus).toBe('failed');
    expect(source.lastSyncError).toBe('Unknown provider type: missing');
  });

  it('replaces and verifies the complete dataset in the journal manager', async () => {
    const source = createSource();
    source.providerType = 'rest';
    const provider = {
      fetch: jest.fn().mockResolvedValue({
        records: [{ value: 3.5 }],
        hasMore: false,
      }),
    };
    const dataSources = {
      findOne: jest.fn().mockResolvedValue(source),
      getDecryptedCredentials: jest.fn().mockReturnValue(null),
    };
    const datasetService = {
      prepareValidRecords: jest.fn().mockReturnValue({
        records: [{ value: 3.5 }],
        errors: [],
      }),
    };
    const service = new DataSourceSyncService(
      { getProvider: jest.fn().mockReturnValue(provider) } as any,
      dataSources as any,
      datasetService as any,
      {} as any,
    );
    const prepared = await service.prepareSync(4);
    const sourceRepository = {
      findOne: jest.fn().mockImplementation(async () => source),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const datasetRepository = {
      create: jest.fn().mockImplementation((value) => value),
      save: jest
        .fn()
        .mockImplementation(async (value) => ({ ...value, id: 12 })),
    };
    const savedRecords: any[] = [];
    const recordRepository = {
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      create: jest.fn().mockImplementation((value) => value),
      save: jest.fn().mockImplementation(async (value) => {
        const saved = { ...value, id: 21 + savedRecords.length };
        savedRecords.push(saved);
        return saved;
      }),
      find: jest.fn().mockImplementation(async () => savedRecords),
    };
    let savedLog: any;
    const logRepository = {
      create: jest.fn().mockImplementation((value) => value),
      save: jest.fn().mockImplementation(async (value) => {
        savedLog = { ...value, id: 9 };
        return savedLog;
      }),
      findOneBy: jest.fn().mockImplementation(async () => savedLog),
    };
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity === DataSourceEntity) return sourceRepository;
        if (entity === DataSourceSyncLogEntity) return logRepository;
        if (entity.name === 'DatasetEntity') return datasetRepository;
        if (entity.name === 'DatasetRecordEntity') return recordRepository;
        throw new Error(`Unexpected repository ${entity.name}`);
      }),
    };

    await expect(
      service.applyPreparedSync(prepared, manager as any),
    ).resolves.toEqual(
      expect.objectContaining({
        status: 'success',
        observation: expect.objectContaining({
          datasetId: 12,
          recordsCreated: 1,
        }),
      }),
    );
    expect(recordRepository.delete).toHaveBeenCalledWith({
      dataset: { id: 12 },
    });
    expect(recordRepository.find).toHaveBeenCalledWith({
      where: { dataset: { id: 12 } },
    });
  });
});

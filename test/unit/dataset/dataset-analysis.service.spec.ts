import { BadRequestException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { DatasetAnalysisService } from '../../../src/dataset/dataset-analysis.service';
import { DatasetEntity } from '../../../src/dataset/dataset.entity';
import { ExecutionPriority } from '../../../src/execution/execution-priority.enum';
import type { ExecutionService } from '../../../src/execution/execution.service';

describe('DatasetAnalysisService', () => {
  const scope = { ownerPrincipal: '7' };
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
    const manager = {
      getRepository: jest.fn((entity) =>
        entity === DatasetEntity ? datasetRepository : recordRepository,
      ),
    } as unknown as EntityManager;
    const service = new DatasetAnalysisService(
      executionService as unknown as ExecutionService,
    );
    return { service, executionService, manager };
  }

  it('freezes records and linked labels into an input artifact', async () => {
    const { service, executionService, manager } = setup();

    await expect(
      service.createExecution(
        'distribution',
        [1],
        { field: 'category_id' },
        scope,
        'request-id',
      ),
    ).resolves.toEqual({ executionId: 'execution-id' });

    const call = executionService.createCode.mock.calls[0];
    expect(call.slice(0, 3)).toEqual([
      'distribution',
      ExecutionPriority.NORMAL,
      { datasetId: 1, params: { field: 'category_id' } },
    ]);
    expect(call[3]).toMatchObject({ ...scope, requestId: 'request-id' });
    const [artifact] = await call[3].snapshotArtifacts(manager);
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
      service.createExecution('unsupported-operation', [1], {}, scope),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(executionService.createCode).not.toHaveBeenCalled();
  });

  it('allows multiple datasets only for query executions', async () => {
    const { service, executionService } = setup();

    await expect(
      service.createExecution('summary', [1, 2], {}, scope),
    ).rejects.toThrow('Only dataset query supports multiple datasets');
    expect(executionService.createCode).not.toHaveBeenCalled();
  });

  it.each([
    ['summary', {}],
    ['correlation', { field1: 'price', field2: 'amount' }],
    ['correlation-matrix', { fields: ['price', 'amount'] }],
    ['group-by', { valueField: 'price', groupField: 'kind', fn: 'sum' }],
    ['time-series', { dateField: 'day', valueField: 'count', period: 'M' }],
    ['outliers', { field: 'price' }],
    ['pivot-table', { rowField: 'day', colField: 'kind' }],
    ['chart', { xField: 'price', chartType: 'bar' }],
  ])('uses the registered execution type for %s', async (operation, params) => {
    const { service, executionService } = setup();
    await service.createExecution(operation, [1, 1, 0, -7], params, scope);
    expect(executionService.createCode).toHaveBeenCalledWith(
      operation,
      ExecutionPriority.NORMAL,
      { datasetId: 1, params },
      expect.objectContaining({
        ownerPrincipal: '7',
        snapshotArtifacts: expect.any(Function),
      }),
    );
  });

  it('preserves unique query dataset IDs in order and rejects missing datasets at snapshot time', async () => {
    const { service, executionService, manager } = setup();
    await expect(
      service.createExecution('query', [0, -2], {}, scope),
    ).rejects.toThrow('At least one dataset is required');
    await service.createExecution('query', [2, 1, 2], {}, scope);
    expect(executionService.createCode).toHaveBeenCalledWith(
      'query',
      ExecutionPriority.NORMAL,
      { datasetIds: [2, 1], params: {} },
      expect.anything(),
    );
    const [, , , options] = executionService.createCode.mock.calls[0];
    await expect(options.snapshotArtifacts(manager)).rejects.toThrow(
      'Dataset with id 2 not found',
    );
    await service.createExecution('query', [1], {}, scope);
    expect(executionService.createCode).toHaveBeenLastCalledWith(
      'query',
      ExecutionPriority.NORMAL,
      { datasetId: 1, params: {} },
      expect.anything(),
    );
  });
});

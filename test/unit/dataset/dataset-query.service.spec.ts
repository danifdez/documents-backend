import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  DatasetQueryService,
  type RecordFilter,
} from '../../../src/dataset/dataset-query.service';
import { DatasetEntity } from '../../../src/dataset/dataset.entity';
import { DatasetRecordEntity } from '../../../src/dataset/dataset-record.entity';
import { DatasetFieldDto } from '../../../src/dataset/dto/dataset.dto';
import { buildDataset } from '../../factories';
import {
  createMockQueryBuilder,
  createMockRepository,
  MockRepository,
} from '../../test-utils';

const schema = [
  { key: 'amount', name: 'Amount', type: 'number' as const, required: false },
  { key: 'category', name: 'Category', type: 'text' as const, required: false },
];

describe('DatasetQueryService', () => {
  let service: DatasetQueryService;
  let datasetRepo: MockRepository<DatasetEntity>;
  let recordRepo: MockRepository<DatasetRecordEntity>;
  let qb: ReturnType<typeof createMockQueryBuilder>;

  beforeEach(() => {
    datasetRepo = createMockRepository<DatasetEntity>();
    recordRepo = createMockRepository<DatasetRecordEntity>();
    qb = createMockQueryBuilder<DatasetRecordEntity>();
    recordRepo.createQueryBuilder.mockReturnValue(qb);
    service = new DatasetQueryService(datasetRepo as any, recordRepo as any);
  });

  describe('queryRecords', () => {
    it('rejects field keys that are not in the schema', async () => {
      datasetRepo.findOne.mockResolvedValue(buildDataset({ schema }));

      await expect(
        service.queryRecords(1, {
          sort: "amount')::numeric, (SELECT pg_sleep(10))--",
        }),
      ).rejects.toThrow(BadRequestException);

      expect(qb.orderBy).not.toHaveBeenCalled();
    });

    it('sorts by a validated numeric field', async () => {
      datasetRepo.findOne.mockResolvedValue(buildDataset({ schema }));
      qb.getCount.mockResolvedValue(1);
      qb.getMany.mockResolvedValue([]);

      await service.queryRecords(1, { sort: 'amount', order: 'desc' });

      expect(qb.orderBy).toHaveBeenCalledWith(
        "(record.data ->> 'amount')::numeric",
        'DESC',
      );
    });
  });

  it('filters numeric comparisons while searching only text and select fields', async () => {
    const fields = [
      ...schema,
      { key: 'state', name: 'State', type: 'select' as const, required: false },
    ];
    datasetRepo.findOne.mockResolvedValue(buildDataset({ schema: fields }));
    const filters: RecordFilter[] = [
      { field: 'amount', operator: 'eq', value: '3' },
      { field: 'amount', operator: 'gt', value: '1' },
      { field: 'amount', operator: 'gte', value: '2' },
      { field: 'amount', operator: 'lt', value: '7' },
      { field: 'amount', operator: 'lte', value: '8' },
      { field: 'category', operator: 'contains', value: 'Alpha' },
      { field: 'state', operator: 'eq', value: 'confirmed' },
    ];
    qb.getCount.mockResolvedValue(21);
    qb.getMany.mockResolvedValue([{ id: 7 }]);
    await expect(
      service.queryRecords(1, {
        filters,
        search: 'sample',
        page: 2,
        limit: 10,
        sort: 'category',
        relatedTo: 9,
        relationId: 12,
      }),
    ).resolves.toEqual({ records: [{ id: 7 }], total: 21 });
    expect(qb.andWhere.mock.calls.slice(0, 5)).toEqual(
      ['=', '>', '>=', '<', '<='].map((op, i) => [
        `(record.data ->> :field_${i})::numeric ${op} :filter_${i}`,
        { [`field_${i}`]: 'amount', [`filter_${i}`]: Number(filters[i].value) },
      ]),
    );
    expect(qb.andWhere).toHaveBeenCalledWith(
      'record.data ->> :field_5 ILIKE :filter_5',
      {
        field_5: 'category',
        filter_5: '%Alpha%',
      },
    );
    expect(qb.andWhere).toHaveBeenCalledWith(
      'record.data ->> :field_6 = :filter_6',
      {
        field_6: 'state',
        filter_6: 'confirmed',
      },
    );
    expect(qb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining(':search_field_1 ILIKE :search_term'),
      {
        search_field_0: 'category',
        search_field_1: 'state',
        search_term: '%sample%',
      },
    );
    expect(qb.andWhere).toHaveBeenCalledWith(expect.stringContaining('UNION'), {
      relatedTo: 9,
      relationId: 12,
    });
    expect(qb.orderBy).toHaveBeenCalledWith(
      "record.data ->> 'category'",
      'ASC',
    );
    expect(qb.skip).toHaveBeenCalledWith(10);
    expect(qb.take).toHaveBeenCalledWith(10);
  });

  it('uses newest-first order and skips keyword search on numeric-only schemas', async () => {
    datasetRepo.findOne.mockResolvedValue(
      buildDataset({ schema: [schema[0]] }),
    );
    await service.queryRecords(1, { search: 'sample', relatedTo: 9 });
    expect(qb.andWhere).not.toHaveBeenCalled();
    expect(qb.orderBy).toHaveBeenCalledWith('record.created_at', 'DESC');
    expect(qb.skip).toHaveBeenCalledWith(0);
    expect(qb.take).toHaveBeenCalledWith(50);
  });

  it('requires an existing dataset for queries and aggregates', async () => {
    await expect(service.queryRecords(99, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.aggregate(99, { field: 'amount', fn: 'max' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(recordRepo.createQueryBuilder).not.toHaveBeenCalled();
    expect(recordRepo.query).not.toHaveBeenCalled();
  });

  it('counts rows and aggregates numeric values across a dataset', async () => {
    datasetRepo.findOne.mockResolvedValue(buildDataset({ schema }));
    recordRepo.query.mockResolvedValue([{ value: 3 }]);
    await expect(
      service.aggregate(1, { field: 'amount', fn: 'count' }),
    ).resolves.toEqual([{ value: 3 }]);
    await service.aggregate(1, { field: 'amount', fn: 'avg' });
    expect(recordRepo.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('COUNT(*)'),
      [1],
    );
    expect(recordRepo.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('avg((data->>$2)::numeric)'),
      [1, 'amount'],
    );
    await expect(
      service.aggregate(1, { field: 'amount', fn: 'median' as 'avg' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(recordRepo.query).toHaveBeenCalledTimes(2);
  });

  describe('aggregate', () => {
    it('rejects group keys that are not in the schema', async () => {
      datasetRepo.findOne.mockResolvedValue(buildDataset({ schema }));

      await expect(
        service.aggregate(1, {
          field: 'amount',
          fn: 'sum',
          groupBy: "category')::numeric, (SELECT pg_sleep(10))--",
        }),
      ).rejects.toThrow(BadRequestException);

      expect(recordRepo.query).not.toHaveBeenCalled();
    });

    it('binds field and group keys as query parameters', async () => {
      datasetRepo.findOne.mockResolvedValue(buildDataset({ schema }));
      recordRepo.query.mockResolvedValue([{ group: 'a', value: 3 }]);

      await service.aggregate(1, {
        field: 'amount',
        fn: 'sum',
        groupBy: 'category',
      });

      const [sql, params] = recordRepo.query.mock.calls[0];
      expect(sql).toContain('data->>$2');
      expect(sql).toContain('data->>$3');
      expect(sql).not.toContain("'category'");
      expect(sql).not.toContain("'amount'");
      expect(params).toEqual([1, 'category', 'amount']);
    });

    it('counts grouped rows without interpolating the group key', async () => {
      datasetRepo.findOne.mockResolvedValue(buildDataset({ schema }));
      recordRepo.query.mockResolvedValue([]);

      await service.aggregate(1, {
        field: 'amount',
        fn: 'count',
        groupBy: 'category',
      });

      const [sql, params] = recordRepo.query.mock.calls[0];
      expect(sql).toContain('COUNT(*)::integer');
      expect(sql).toContain('data->>$2');
      expect(params).toEqual([1, 'category']);
    });
  });
});

describe('DatasetFieldDto', () => {
  const valid = {
    key: 'total_amount',
    name: 'Total amount',
    type: 'number',
    required: false,
  };

  it('accepts lowercase snake_case keys', async () => {
    const dto = plainToInstance(DatasetFieldDto, valid);
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it.each([
    "amount')::numeric, (SELECT pg_sleep(10))--",
    'amount; DROP TABLE dataset_records',
    'Amount',
    'amount-2',
  ])('rejects unsafe key %s', async (key) => {
    const dto = plainToInstance(DatasetFieldDto, { ...valid, key });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'key')).toBe(true);
  });
});

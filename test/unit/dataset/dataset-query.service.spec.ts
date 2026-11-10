import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DatasetQueryService } from '../../../src/dataset/dataset-query.service';
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

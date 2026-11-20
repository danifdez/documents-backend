import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import {
  DatasetEntity,
  DatasetField,
} from '../../../src/dataset/dataset.entity';
import { DatasetChartEntity } from '../../../src/dataset/dataset-chart.entity';
import { DatasetCsvService } from '../../../src/dataset/dataset-csv.service';
import { DatasetRecordEntity } from '../../../src/dataset/dataset-record.entity';
import { DatasetRecordLinkEntity } from '../../../src/dataset/dataset-record-link.entity';
import { DatasetRelationEntity } from '../../../src/dataset/dataset-relation.entity';
import { DatasetService } from '../../../src/dataset/dataset.service';
import type { CreateDatasetDto } from '../../../src/dataset/dto/dataset.dto';
import { ResourceService } from '../../../src/resource/resource.service';
import { createMockQueryBuilder, createMockRepository } from '../../test-utils';

const field = (
  key: string,
  type: DatasetField['type'] = 'text',
  required = false,
): DatasetField => ({
  key,
  name: key,
  type,
  required,
});

describe('DatasetService', () => {
  let service: DatasetService;
  const repository = () => ({
    ...createMockRepository(),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => value),
    findAndCount: jest.fn(),
  });
  let datasets: ReturnType<typeof repository>;
  let records: ReturnType<typeof repository>;
  let relations: ReturnType<typeof repository>;
  let links: ReturnType<typeof repository>;
  let charts: ReturnType<typeof repository>;
  let resources: { findByIds: jest.Mock };
  const base: CreateDatasetDto = { name: 'Study data', schema: [] };
  const schema = [
    field('label', 'text', true),
    field('count', 'number'),
    field('published', 'boolean'),
    field('optional'),
  ];

  beforeEach(async () => {
    datasets = repository();
    records = repository();
    relations = repository();
    links = repository();
    charts = repository();
    resources = { findByIds: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        DatasetService,
        DatasetCsvService,
        { provide: getRepositoryToken(DatasetEntity), useValue: datasets },
        { provide: getRepositoryToken(DatasetRecordEntity), useValue: records },
        {
          provide: getRepositoryToken(DatasetRelationEntity),
          useValue: relations,
        },
        {
          provide: getRepositoryToken(DatasetRecordLinkEntity),
          useValue: links,
        },
        { provide: getRepositoryToken(DatasetChartEntity), useValue: charts },
        { provide: ResourceService, useValue: resources },
      ],
    }).compile();
    service = module.get(DatasetService);
  });

  describe('datasets and source configuration', () => {
    it('lists datasets and record counts, optionally scoped to a project', async () => {
      const qb = {
        ...createMockQueryBuilder(),
        loadRelationCountAndMap: jest.fn(),
      };
      qb.loadRelationCountAndMap.mockReturnValue(qb);
      qb.leftJoinAndSelect.mockReturnValue(qb);
      qb.getMany.mockResolvedValue([{ id: 1, recordCount: 3 }]);
      datasets.createQueryBuilder.mockReturnValue(qb);

      await expect(service.findAllDatasets()).resolves.toEqual([
        { id: 1, recordCount: 3 },
      ]);
      expect(qb.where).not.toHaveBeenCalled();
      await service.findAllDatasets(9);
      expect(qb.where).toHaveBeenCalledWith('dataset.project.id = :projectId', {
        projectId: 9,
      });
      expect(qb.loadRelationCountAndMap).toHaveBeenCalledWith(
        'dataset.recordCount',
        'dataset.records',
      );
      expect(qb.orderBy).toHaveBeenCalledWith('dataset.name', 'ASC');
    });

    it('searches by dataset name and description in the requested project', async () => {
      const qb = createMockQueryBuilder();
      qb.getRawMany.mockResolvedValue([{ d_id: 1 }]);
      datasets.createQueryBuilder.mockReturnValue(qb);
      await expect(service.globalSearch(' ')).resolves.toEqual([]);
      await expect(service.globalSearch('sample', 9)).resolves.toEqual([
        { d_id: 1 },
      ]);
      expect(qb.where).toHaveBeenCalledWith(
        'unaccent(d.name) ILIKE unaccent(:q) OR unaccent(d.description) ILIKE unaccent(:q)',
        { q: '%sample%' },
      );
      expect(qb.andWhere).toHaveBeenCalledWith('d.project_id = :projectId', {
        projectId: 9,
      });
    });

    it('creates manual datasets with no extraction source', async () => {
      await expect(
        service.createDataset({
          ...base,
          projectId: 9,
          description: '',
          sourceConfig: { resourceIds: [1] },
        }),
      ).resolves.toEqual({
        ...base,
        project: { id: 9 },
        description: null,
        sourceMode: 'manual',
        sourceConfig: {},
      });
    });

    const invalidSources: Array<[Partial<CreateDatasetDto>, string]> = [
      [
        { sourceMode: 'project_resources' },
        'requires the dataset to have a projectId',
      ],
      [
        {
          sourceMode: 'project_resources',
          projectId: 9,
          sourceConfig: { resourceTypeFilter: 'pdf' },
        },
        'must be an array of strings',
      ],
      [
        {
          sourceMode: 'project_resources',
          projectId: 9,
          sourceConfig: { resourceTypeFilter: ['pdf', 2] },
        },
        'must be an array of strings',
      ],
      [{ sourceMode: 'resource_selection' }, 'to be a non-empty number[]'],
      [
        { sourceMode: 'resource_selection', sourceConfig: { resourceIds: [] } },
        'to be a non-empty number[]',
      ],
      [
        {
          sourceMode: 'resource_selection',
          sourceConfig: { resourceIds: ['4'] },
        },
        'to be a non-empty number[]',
      ],
      [
        {
          sourceMode: 'resource_selection',
          sourceConfig: { resourceIds: [Infinity] },
        },
        'to be a non-empty number[]',
      ],
    ];
    it.each(invalidSources)(
      'rejects invalid source settings %#',
      async (options, message) => {
        await expect(
          service.createDataset({ ...base, ...options }),
        ).rejects.toThrow(message);
        expect(datasets.save).not.toHaveBeenCalled();
      },
    );

    it('keeps existing project and mode when updating source settings', async () => {
      datasets.findOne.mockResolvedValue({
        ...base,
        project: { id: 9 },
        sourceMode: 'project_resources',
        sourceConfig: {},
      });
      await expect(
        service.updateDataset(1, {
          name: 'Renamed',
          description: '',
          schema,
          sourceConfig: { resourceTypeFilter: ['pdf'] },
        }),
      ).resolves.toMatchObject({
        name: 'Renamed',
        description: null,
        schema,
        project: { id: 9 },
        sourceMode: 'project_resources',
        sourceConfig: { resourceTypeFilter: ['pdf'] },
      });
      await expect(
        service.updateDataset(1, { projectId: null, sourceMode: 'manual' }),
      ).resolves.toMatchObject({
        project: null,
        sourceMode: 'manual',
        sourceConfig: {},
      });
    });

    it('validates a new mode against the supplied project and retained source config', async () => {
      datasets.findOne.mockResolvedValue({
        ...base,
        project: null,
        sourceConfig: {},
      });
      await expect(
        service.updateDataset(1, {
          projectId: 9,
          sourceMode: 'project_resources',
        }),
      ).resolves.toMatchObject({
        project: { id: 9 },
        sourceMode: 'project_resources',
        sourceConfig: {},
      });
      await expect(
        service.updateDataset(1, {
          sourceMode: 'resource_selection',
          sourceConfig: { resourceIds: [7] },
        }),
      ).resolves.toMatchObject({
        sourceMode: 'resource_selection',
        sourceConfig: { resourceIds: [7] },
      });
    });

    it('updates metadata without resetting a configured source', async () => {
      datasets.findOne.mockResolvedValue({
        ...base,
        sourceMode: 'resource_selection',
        sourceConfig: { resourceIds: [4] },
      });
      await expect(
        service.updateDataset(1, { description: 'Updated' }),
      ).resolves.toMatchObject({
        description: 'Updated',
        sourceMode: 'resource_selection',
        sourceConfig: { resourceIds: [4] },
      });
    });

    it('deletes only an existing dataset', async () => {
      await expect(service.removeDataset(12)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(datasets.delete).not.toHaveBeenCalled();
      datasets.findOne.mockResolvedValue({ id: 12 });
      await service.removeDataset(12);
      expect(datasets.delete).toHaveBeenCalledWith({ id: 12 });
    });
  });

  describe('schema analysis and record persistence', () => {
    beforeEach(() => datasets.findOne.mockResolvedValue({ id: 1, schema }));

    it('reports nonempty removed fields and incompatible type changes', async () => {
      datasets.findOne.mockResolvedValue({
        schema: ['removed', 'unused', 'value', 'label'].map((key) =>
          field(key),
        ),
      });
      const qb = createMockQueryBuilder();
      qb.getCount.mockResolvedValueOnce(2).mockResolvedValueOnce(0);
      records.createQueryBuilder.mockReturnValue(qb);
      records.find.mockResolvedValue(
        ['12', 'abc', '', null, undefined].map((value) => ({
          data: { value },
        })),
      );
      await expect(
        service.analyzeSchemaChange(1, [
          field('value', 'number'),
          field('label'),
          field('new'),
        ]),
      ).resolves.toEqual({
        removedFields: [
          { key: 'removed', name: 'removed', affectedRecords: 2 },
        ],
        typeChanges: [
          {
            key: 'value',
            name: 'value',
            oldType: 'text',
            newType: 'number',
            incompatibleRecords: 1,
          },
        ],
        safe: false,
      });
      expect(qb.andWhere).toHaveBeenCalledWith('record.data ? :key', {
        key: 'removed',
      });
    });

    const conversions: Array<[DatasetField['type'], unknown[], number]> = [
      ['boolean', [true, 'true', 'false', 'maybe'], 1],
      ['date', ['2026-11-20', 'bad'], 1],
      ['datetime', ['2026-11-20T12:30:00Z', 'bad'], 1],
      ['time', ['09:30', '09:30:00', '9 AM'], 1],
      ['text', [1, false], 0],
      ['select', ['A', 'B'], 0],
    ];
    it.each(conversions)(
      'counts existing values when changing a column to %s',
      async (type, values, count) => {
        datasets.findOne.mockResolvedValue({
          schema: [field('value', 'number')],
        });
        records.find.mockResolvedValue(
          values.map((value) => ({ data: { value } })),
        );
        await expect(
          service.analyzeSchemaChange(1, [field('value', type)]),
        ).resolves.toMatchObject({
          typeChanges: [{ newType: type, incompatibleRecords: count }],
        });
      },
    );

    it('allows new columns without reading existing records', async () => {
      await expect(
        service.analyzeSchemaChange(1, [...schema, field('another')]),
      ).resolves.toEqual({
        removedFields: [],
        typeChanges: [],
        safe: true,
      });
      expect(records.find).not.toHaveBeenCalled();
    });

    const invalidValues: Array<[DatasetField, unknown, string]> = [
      [field('count', 'number'), 'two', 'must be a valid number'],
      [field('flag', 'boolean'), 1, 'must be a boolean'],
      [field('day', 'date'), 'none', 'must be a valid date'],
      [field('timestamp', 'datetime'), 'none', 'must be a valid datetime'],
      [field('clock', 'time'), '9 AM', 'must be a valid time'],
      [
        { ...field('status', 'select'), options: ['open', 'closed'] },
        'held',
        'must be one of: open, closed',
      ],
    ];
    it.each(invalidValues)(
      'rejects invalid values for $key',
      (column, value, message) => {
        expect(
          service.validateRecordData([column], { [column.key]: value }),
        ).toEqual([expect.stringContaining(message)]);
      },
    );

    it('accepts all supported value types and reports each missing required value', () => {
      const columns = [
        field('n', 'number'),
        field('a', 'boolean'),
        field('b', 'boolean'),
        field('c', 'boolean'),
        field('d', 'date'),
        field('dt', 'datetime'),
        field('t', 'time'),
        { ...field('s', 'select'), options: ['open'] },
        field('any', 'select'),
      ];
      expect(
        service.validateRecordData(columns, {
          n: 0,
          a: false,
          b: 'true',
          c: 'false',
          d: '2026-11-20',
          dt: '2026-11-20T13:00:00Z',
          t: '13:00:30',
          s: 'open',
          any: 'anything',
        }),
      ).toEqual([]);
      expect(
        service.validateRecordData(
          ['absent', 'nil', 'empty'].map((key) => field(key, 'text', true)),
          { nil: null, empty: '' },
        ),
      ).toEqual([
        'Field "absent" is required',
        'Field "nil" is required',
        'Field "empty" is required',
      ]);
    });

    it('cleans inputs and preserves row numbers when preparing an import', () => {
      expect(
        service.prepareValidRecords(schema, [
          {
            label: 'A',
            count: '0',
            published: 'true',
            optional: '',
            unknown: 'discard',
          },
          { label: '' },
          { label: 'C', published: false, optional: undefined },
        ]),
      ).toEqual({
        records: [
          { label: 'A', count: 0, published: true, optional: null },
          { label: 'C', published: false },
        ],
        errors: [{ row: 2, messages: ['Field "label" is required'] }],
      });
    });

    it('saves valid records from CSV in a batch with extraction metadata', async () => {
      datasets.save.mockImplementation(async (value) => ({ id: 1, ...value }));
      await expect(
        service.createFromCsv(
          'Imported',
          schema,
          [{ label: 'A', count: '2' }, {}],
          9,
        ),
      ).resolves.toMatchObject({
        dataset: { id: 1, project: { id: 9 } },
        imported: 1,
        errors: [{ row: 2, messages: ['Field "label" is required'] }],
      });
      expect(records.save).toHaveBeenCalledWith(
        [
          {
            dataset: { id: 1 },
            data: { label: 'A', count: 2 },
            cellMetadata: {},
            sourceResourceId: null,
            extractionStatus: 'extracted',
            extractionError: null,
          },
        ],
        { chunk: 100 },
      );
    });

    it('does not write a batch with no valid records', async () => {
      await expect(service.bulkCreateRecords(1, [{}])).resolves.toMatchObject({
        imported: 0,
      });
      expect(records.save).not.toHaveBeenCalled();
    });

    it('creates cleaned manual records and rejects invalid records', async () => {
      await expect(
        service.createRecord(1, { data: {} }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(records.save).not.toHaveBeenCalled();
      await expect(
        service.createRecord(1, {
          data: { label: 'A', published: 'false', optional: null },
        }),
      ).resolves.toMatchObject({
        data: { label: 'A', published: false, optional: null },
        dataset: { id: 1 },
      });
    });

    it('flags edited anchors and preserves anchors on unchanged or omitted cells', async () => {
      const anchor = { sourceResourceId: 17, page: 2 };
      records.findOne.mockResolvedValue({
        id: 2,
        data: { label: 'Old', count: 3, optional: 'Old' },
        cellMetadata: { label: anchor, count: anchor, optional: anchor },
      });
      await expect(
        service.updateRecord(1, 2, {
          data: { label: 'New', count: '3', published: true },
        }),
      ).resolves.toMatchObject({
        data: { label: 'New', count: 3, published: true },
        cellMetadata: {
          label: { ...anchor, editedByUser: true },
          count: anchor,
          optional: anchor,
        },
      });
      expect(records.findOne).toHaveBeenCalledWith({
        where: { id: 2, dataset: { id: 1 } },
      });
    });

    it('lists and removes records only within the requested dataset', async () => {
      records.findAndCount.mockResolvedValue([[{ id: 2 }], 21]);
      await expect(service.findRecords(1, 2, 10)).resolves.toEqual({
        records: [{ id: 2 }],
        total: 21,
      });
      expect(records.findAndCount).toHaveBeenCalledWith({
        where: { dataset: { id: 1 } },
        order: { createdAt: 'DESC' },
        skip: 10,
        take: 10,
      });
      await expect(service.removeRecord(1, 2)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      records.findOne.mockResolvedValue({ id: 2 });
      await service.removeRecord(1, 2);
      expect(records.delete).toHaveBeenCalledWith({ id: 2 });
    });

    it('skips empty bulk deletes and constrains the deletion to the dataset', async () => {
      const qb = createMockQueryBuilder();
      qb.execute
        .mockResolvedValueOnce({ affected: 1 })
        .mockResolvedValueOnce({});
      records.createQueryBuilder.mockReturnValue(qb);
      await expect(service.bulkDeleteRecords(1, [])).resolves.toEqual({
        deleted: 0,
      });
      expect(records.createQueryBuilder).not.toHaveBeenCalled();
      await expect(service.bulkDeleteRecords(1, [2, 3])).resolves.toEqual({
        deleted: 1,
      });
      expect(qb.where).toHaveBeenCalledWith('dataset_id = :datasetId', {
        datasetId: 1,
      });
      expect(qb.andWhere).toHaveBeenCalledWith('id IN (:...ids)', {
        ids: [2, 3],
      });
      await expect(service.bulkDeleteRecords(1, [99])).resolves.toEqual({
        deleted: 0,
      });
    });

    it('exports a safe filename and resolved anchor labels with a single resource lookup', async () => {
      datasets.findOne.mockResolvedValue({
        id: 1,
        name: 'Annual study!',
        schema: [field('label')],
      });
      records.find.mockResolvedValue([
        {
          data: { label: 'First' },
          cellMetadata: {
            label: { sourceResourceId: 7, page: 2, quote: 'A, B' },
          },
        },
        {
          data: { label: 'Second' },
          cellMetadata: { label: { sourceResourceId: 7 } },
        },
        { data: { label: 'Third' }, cellMetadata: null },
        {
          data: { label: 'Missing source' },
          cellMetadata: { label: { sourceResourceId: 99 } },
        },
      ]);
      resources.findByIds.mockResolvedValue([{ id: 7, name: 'Minutes' }]);
      await expect(
        service.exportCsv(1, { includeAnchors: true }),
      ).resolves.toEqual({
        filename: 'Annual_study_.csv',
        csv: 'label,label_source,label_page,label_quote\nFirst,Minutes,2,"A, B"\nSecond,Minutes,,\nThird,,,\nMissing source,,,',
      });
      expect(resources.findByIds).toHaveBeenCalledTimes(1);
      expect(resources.findByIds).toHaveBeenCalledWith([7, 99]);
      await expect(
        service.exportCsv(1, { includeAnchors: false }),
      ).resolves.toMatchObject({
        csv: 'label\nFirst\nSecond\nThird\nMissing source',
      });
      expect(resources.findByIds).toHaveBeenCalledTimes(1);
    });

    it('rejects operations scoped to a missing dataset', async () => {
      datasets.findOne.mockResolvedValue(null);
      await expect(service.updateDataset(99, {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.analyzeSchemaChange(99, [])).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        service.createRecord(99, { data: {} }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.updateRecord(99, 2, { data: {} }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.findRecords(99)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.bulkCreateRecords(99, [])).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.bulkDeleteRecords(99, [])).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        service.exportCsv(99, { includeAnchors: true }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.createChart(99, { name: 'Chart', config: {} }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('links and charts', () => {
    const relationDto = {
      sourceDatasetId: 1,
      targetDatasetId: 2,
      relationType: 'one-to-many',
    };
    const linkDto = { sourceRecordId: 11, targetRecordId: 21 };
    const sourceRecord = { id: 11, dataset: { id: 1 }, data: { code: 'A' } };
    const targetRecord = { id: 21, dataset: { id: 2 }, data: { code: 'B' } };
    const relation = {
      id: 3,
      sourceDataset: { id: 1 },
      targetDataset: { id: 2 },
      relationType: 'one-to-many',
      name: null,
    };

    it('looks up linked records by primary key or by a configured column', async () => {
      datasets.findOne.mockResolvedValue({ id: 1 });
      const qb = createMockQueryBuilder();
      qb.getMany.mockResolvedValue([sourceRecord]);
      records.createQueryBuilder.mockReturnValue(qb);
      await expect(service.resolveLinkedRecords(1, [])).resolves.toEqual({});
      await expect(
        service.resolveLinkedRecords(1, ['invalid']),
      ).resolves.toEqual({});
      expect(records.createQueryBuilder).not.toHaveBeenCalled();
      await expect(
        service.resolveLinkedRecords(1, ['11', 'invalid']),
      ).resolves.toEqual({ '11': { code: 'A' } });
      expect(qb.andWhere).toHaveBeenCalledWith('r.id IN (:...ids)', {
        ids: [11],
      });
      await expect(
        service.resolveLinkedRecords(1, ['A', 2], 'code'),
      ).resolves.toEqual({ A: { code: 'A' } });
      expect(qb.andWhere).toHaveBeenCalledWith(
        'r.data ->> :field IN (:...vals)',
        { field: 'code', vals: ['A', '2'] },
      );
      datasets.findOne.mockResolvedValue(null);
      await expect(service.resolveLinkedRecords(99, [1])).resolves.toEqual({});
    });

    it('creates relations only between existing datasets and finds either direction', async () => {
      datasets.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 1 })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 1 })
        .mockResolvedValueOnce({ id: 2 });
      await expect(service.createRelation(relationDto)).rejects.toThrow(
        'Source dataset',
      );
      await expect(service.createRelation(relationDto)).rejects.toThrow(
        'Target dataset',
      );
      await expect(service.createRelation(relationDto)).resolves.toEqual({
        sourceDataset: { id: 1 },
        targetDataset: { id: 2 },
        relationType: 'one-to-many',
        name: null,
      });
      relations.find.mockResolvedValue([relation]);
      await expect(service.findRelations(1)).resolves.toEqual([relation]);
      expect(relations.find).toHaveBeenCalledWith({
        where: [{ sourceDataset: { id: 1 } }, { targetDataset: { id: 1 } }],
        relations: ['sourceDataset', 'targetDataset'],
      });
      await expect(service.removeRelation(3)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      relations.findOne.mockResolvedValue(relation);
      await service.removeRelation(3);
      expect(relations.delete).toHaveBeenCalledWith({ id: 3 });
    });

    it('validates both ends before saving record links', async () => {
      await expect(service.linkRecords(3, linkDto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      relations.findOne.mockResolvedValue(relation);
      records.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(targetRecord);
      await expect(service.linkRecords(3, linkDto)).rejects.toThrow(
        'Source record',
      );
      await expect(service.linkRecords(3, linkDto)).rejects.toThrow(
        'Source record',
      );
      records.findOne
        .mockResolvedValueOnce(sourceRecord)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(sourceRecord)
        .mockResolvedValueOnce(sourceRecord);
      await expect(service.linkRecords(3, linkDto)).rejects.toThrow(
        'Target record',
      );
      await expect(service.linkRecords(3, linkDto)).rejects.toThrow(
        'Target record',
      );
      expect(links.save).not.toHaveBeenCalled();
      records.findOne
        .mockResolvedValueOnce(sourceRecord)
        .mockResolvedValueOnce(targetRecord);
      await expect(service.linkRecords(3, linkDto)).resolves.toEqual({
        relation: { id: 3 },
        sourceRecord: { id: 11 },
        targetRecord: { id: 21 },
      });
    });

    it('returns outgoing and incoming links with the opposite record and dataset', async () => {
      const qb = createMockQueryBuilder();
      qb.getMany.mockResolvedValue([
        { id: 4, relation, sourceRecord, targetRecord },
      ]);
      links.createQueryBuilder.mockReturnValue(qb);
      await expect(service.getLinkedRecords(11)).resolves.toMatchObject([
        {
          linkId: 4,
          linkedRecord: targetRecord,
          linkedDataset: { id: 2 },
          direction: 'outgoing',
        },
      ]);
      await expect(service.getLinkedRecords(21)).resolves.toMatchObject([
        {
          linkId: 4,
          linkedRecord: sourceRecord,
          linkedDataset: { id: 1 },
          direction: 'incoming',
        },
      ]);
      await expect(service.unlinkRecords(3, 4)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      links.findOne.mockResolvedValue({ id: 4 });
      await service.unlinkRecords(3, 4);
      expect(links.findOne).toHaveBeenCalledWith({
        where: { id: 4, relation: { id: 3 } },
      });
      expect(links.delete).toHaveBeenCalledWith({ id: 4 });
    });

    it('creates, updates, lists, and removes saved charts', async () => {
      const chart = {
        id: 3,
        dataset: { id: 1 },
        name: 'Distribution',
        config: { type: 'bar' },
      };
      datasets.findOne.mockResolvedValue({ id: 1 });
      await expect(service.createChart(1, chart)).resolves.toEqual({
        dataset: { id: 1 },
        name: 'Distribution',
        config: { type: 'bar' },
      });
      await expect(service.updateChart(3, {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.removeChart(3)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      charts.findOne.mockResolvedValue(chart);
      charts.find.mockResolvedValue([chart]);
      await expect(
        service.updateChart(3, { name: 'Renamed' }),
      ).resolves.toMatchObject({
        name: 'Renamed',
        config: { type: 'bar' },
      });
      await expect(
        service.updateChart(3, { config: { type: 'line' } }),
      ).resolves.toMatchObject({
        name: 'Renamed',
        config: { type: 'line' },
      });
      await expect(service.findCharts(1)).resolves.toEqual([chart]);
      expect(charts.find).toHaveBeenCalledWith({
        where: { dataset: { id: 1 } },
        order: { updatedAt: 'DESC' },
      });
      await service.removeChart(3);
      expect(charts.delete).toHaveBeenCalledWith({ id: 3 });
    });
  });
});

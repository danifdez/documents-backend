import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Permission } from '../../../src/auth/permission.enum';
import { DatasetController } from '../../../src/dataset/dataset.controller';
import { DatasetCsvService } from '../../../src/dataset/dataset-csv.service';

describe('DatasetController', () => {
  const user = { userId: 7, permissions: { [Permission.EXPORT]: true } };
  const scope = { ownerPrincipal: '7' };
  const id = 'b7dbc5b9-7c9c-49a6-a7a4-b75cb2ac58b8';
  const result = { executionId: id };
  const file = (content: string, originalname = 'source.csv') =>
    ({ buffer: Buffer.from(content), originalname }) as Express.Multer.File;
  let datasets: Record<string, jest.Mock>;
  let query: Record<string, jest.Mock>;
  let extraction: Record<string, jest.Mock>;
  let executions: Record<string, jest.Mock>;
  let analysis: Record<string, jest.Mock>;
  let controller: DatasetController;

  beforeEach(() => {
    const methods = [
      'createFromCsv',
      'bulkCreateRecords',
      'findAllDatasets',
      'findOneDataset',
      'createDataset',
      'updateDataset',
      'analyzeSchemaChange',
      'removeDataset',
      'resolveLinkedRecords',
      'findRecords',
      'createRecord',
      'updateRecord',
      'removeRecord',
      'getLinkedRecords',
      'findRelations',
      'createRelation',
      'removeRelation',
      'linkRecords',
      'unlinkRecords',
      'findCharts',
      'createChart',
      'updateChart',
      'removeChart',
      'bulkDeleteRecords',
      'exportCsv',
    ];
    datasets = Object.fromEntries(methods.map((name) => [name, jest.fn()]));
    query = { queryRecords: jest.fn(), aggregate: jest.fn() };
    extraction = Object.fromEntries(
      ['extractAll', 'extractRow', 'extractCell', 'proposeColumns'].map(
        (name) => [name, jest.fn().mockResolvedValue(result)],
      ),
    );
    const storedResult = {
      status: 'completed',
      result: { values: [2] },
      internal: true,
    };
    executions = {
      resolveAccessScope: jest.fn().mockReturnValue(scope),
      readOwnedResult: jest.fn().mockResolvedValue(storedResult),
    };
    analysis = { createExecution: jest.fn().mockResolvedValue(result) };
    controller = new DatasetController(
      datasets as any,
      query as any,
      new DatasetCsvService(),
      extraction as any,
      executions as any,
      analysis as any,
    );
  });

  it('rejects missing and empty uploads and infers input columns and original name', async () => {
    await expect(controller.importFromFile(null, {})).rejects.toThrow(
      'No file uploaded',
    );
    await expect(controller.importFromFile(file(''), {})).rejects.toThrow(
      'CSV file is empty or has no headers',
    );
    await controller.importFromFile(file('Country,Total\nSpain,7'), {
      projectId: '3',
    });
    expect(datasets.createFromCsv).toHaveBeenCalledWith(
      'source',
      [
        { key: 'country', name: 'Country', type: 'text', required: false },
        { key: 'total', name: 'Total', type: 'number', required: false },
      ],
      [{ country: 'Spain', total: '7' }],
      3,
    );
    await controller.importFromFile(file('Country\nSpain', ''), {});
    await controller.importFromFile(file('Country\nSpain'), {
      name: 'Override',
    });
    expect(datasets.createFromCsv.mock.calls.map(([name]) => name)).toEqual([
      'source',
      'Imported dataset',
      'Override',
    ]);
  });

  it('imports tabular data and supports preview and confirmation of a column mapping', async () => {
    await expect(
      controller.createFromTable({ name: '', headers: [], rows: [] }),
    ).rejects.toThrow('No headers provided');
    await controller.createFromTable({
      name: '',
      headers: ['Open'],
      rows: undefined,
    });
    expect(datasets.createFromCsv).toHaveBeenCalledWith(
      'Table Dataset',
      [{ key: 'open', name: 'Open', type: 'text', required: false }],
      [],
      undefined,
    );
    const uploaded = file('Open\ntrue\nfalse');
    await expect(controller.importPreview(1, null)).rejects.toThrow(
      'No file uploaded',
    );
    await expect(controller.importPreview(1, uploaded)).resolves.toEqual({
      headers: ['Open'],
      previewRows: [['true'], ['false']],
      totalRows: 2,
    });
    const mappings = [{ csvColumn: 'Open', fieldKey: 'active' }];
    await expect(
      controller.importConfirm(1, null, { mappings: '' }),
    ).rejects.toThrow('No file uploaded');
    await controller.importConfirm(1, uploaded, {
      mappings: JSON.stringify(mappings),
    });
    await controller.importConfirm(1, uploaded, {
      mappings: mappings as any,
      skipFirstRow: false,
    });
    await controller.importConfirm(1, uploaded, {
      mappings: JSON.stringify(mappings),
      skipFirstRow: 'false',
    });
    expect(datasets.bulkCreateRecords.mock.calls).toEqual([
      [1, [{ active: 'true' }, { active: 'false' }]],
      [1, [{ active: 'Open' }, { active: 'true' }, { active: 'false' }]],
      [1, [{ active: 'Open' }, { active: 'true' }, { active: 'false' }]],
    ]);
  });

  it('uses basic pagination until filters or search options are supplied', async () => {
    await controller.findRecords(1);
    await controller.findRecords(1, { page: '2', limit: '10' });
    expect(datasets.findRecords.mock.calls).toEqual([
      [1, 1, 50],
      [1, 2, 10],
    ]);
    await controller.findRecords(1, {
      page: '2',
      limit: '10',
      search: 'sample',
      sort: 'count',
      order: 'desc',
      relatedTo: '4',
      relationId: '8',
      filter: { count_gte: 7, label_contains: 'sample', unsupported: 'skip' },
    });
    expect(query.queryRecords).toHaveBeenCalledWith(1, {
      filters: [
        { field: 'count', operator: 'gte', value: '7' },
        { field: 'label', operator: 'contains', value: 'sample' },
      ],
      search: 'sample',
      sort: 'count',
      order: 'desc',
      relatedTo: 4,
      relationId: 8,
      page: 2,
      limit: 10,
    });
    await controller.findRecords(1, { search: 'sample', filter: 'invalid' });
    expect(query.queryRecords).toHaveBeenLastCalledWith(
      1,
      expect.objectContaining({ filters: [], page: 1, limit: 50 }),
    );
    await expect(controller.aggregate(1, '', 'count')).rejects.toThrow(
      'field and fn query parameters are required',
    );
    await expect(controller.aggregate(1, 'name', '')).rejects.toThrow(
      'field and fn query parameters are required',
    );
    await controller.aggregate(1, 'count', 'mean', 'label');
    expect(query.aggregate).toHaveBeenCalledWith(1, {
      field: 'count',
      fn: 'mean',
      groupBy: 'label',
    });
  });

  it('authorizes optional capture and requires one source when consent is granted', async () => {
    await controller.extractAll(1, user, undefined, 3);
    expect(extraction.extractAll).toHaveBeenCalledWith(1, '7', undefined);
    await expect(
      controller.extractAll(1, { userId: 7 }, 'granted', 3),
    ).rejects.toBeInstanceOf(ForbiddenException);
    for (const invalid of ['3', 0, 2.5]) {
      await expect(
        controller.extractAll(1, user, 'granted', invalid),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    await controller.extractAll(1, user, 'granted', 3);
    expect(extraction.extractAll.mock.calls).toEqual([
      [1, '7', undefined],
      [1, '7', 3],
    ]);
  });

  it('passes the current owner and returns public result fields', async () => {
    await controller.reExtractRow(1, 2, { columnsToExtract: ['name'] }, user);
    expect(extraction.extractRow).toHaveBeenCalledWith(1, 2, '7', ['name']);
    await controller.reExtractCell(1, 2, 'name', { force: true }, user);
    expect(extraction.extractCell).toHaveBeenCalledWith(1, 2, 'name', '7', {
      force: true,
    });
    await controller.proposeColumns({ resourceIds: [3], projectId: 4 }, user);
    expect(extraction.proposeColumns).toHaveBeenCalledWith([3], '7', 4);
    await expect(controller.requestStats(1, {}, user, id)).resolves.toEqual({
      ...result,
      message: 'Analysis started',
    });
    expect(analysis.createExecution).toHaveBeenCalledWith(
      'summary',
      [1],
      {},
      scope,
      id,
    );
    await expect(
      controller.requestQueryStats({ datasetIds: [] }, user),
    ).rejects.toThrow('datasetIds required');
    await expect(
      controller.requestQueryStats({ datasetIds: [1, 2] }, user),
    ).resolves.toEqual({ ...result, message: 'Query analysis started' });
    expect(analysis.createExecution).toHaveBeenLastCalledWith(
      'query',
      [1, 2],
      {},
      scope,
      undefined,
    );
    await controller.requestStats(
      1,
      { operation: 'distribution', params: { field: 'count' } },
      user,
    );
    expect(analysis.createExecution).toHaveBeenLastCalledWith(
      'distribution',
      [1],
      { field: 'count' },
      scope,
      undefined,
    );
    await expect(controller.getStatsResult(1, id, user)).resolves.toEqual({
      status: 'completed',
      result: { values: [2] },
    });
    await expect(controller.getProposeColumnsResult(id, user)).resolves.toEqual(
      { status: 'completed', result: { values: [2] } },
    );
    expect(executions.readOwnedResult.mock.calls).toEqual([
      [id, scope],
      [id, scope],
    ]);
    expect(
      executions.resolveAccessScope.mock.calls.every(
        ([principal]) => principal === user,
      ),
    ).toBe(true);
  });

  it('exports CSV with a download filename and opts into anchors only when requested', async () => {
    datasets.exportCsv.mockResolvedValue({
      filename: 'source.csv',
      csv: 'name\nAda',
    });
    const res = { setHeader: jest.fn(), send: jest.fn() };
    await controller.exportCsv(1, undefined, res as any);
    await controller.exportCsv(1, 'true', res as any);
    await controller.exportCsv(1, '1', res as any);
    expect(datasets.exportCsv.mock.calls).toEqual([
      [1, { includeAnchors: false }],
      [1, { includeAnchors: true }],
      [1, { includeAnchors: true }],
    ]);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/csv; charset=utf-8',
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="source.csv"',
    );
    expect(res.send).toHaveBeenCalledWith('name\nAda');
  });

  it('uses route identities for dataset settings, records, relations and charts', async () => {
    const data = { data: { name: 'Ada' } };
    const relation = {
      sourceDatasetId: 1,
      targetDatasetId: 2,
      relationType: 'one-to-many',
    };
    const link = { sourceRecordId: 3, targetRecordId: 4 };
    const chart = { name: 'Chart', config: { type: 'line' } };

    await controller.findAll();
    await controller.findAll('2');
    await controller.findOne(1);
    await controller.create({ name: 'Dataset', schema: [] });
    await controller.update(1, { name: 'Renamed' });
    await controller.analyzeSchemaChange(1, { schema: [] });
    await controller.resolveLinks(1, { values: ['CODE'], lookupField: 'code' });
    await controller.resolveLinks(1, {} as any);
    await controller.createRecord(1, data);
    await controller.updateRecord(1, 3, data);
    await controller.removeRecord(1, 3);
    await controller.getLinkedRecords(1, 4);
    await controller.bulkDeleteRecords(1, { recordIds: [3, 4] });
    await controller.findRelations(1);
    await controller.createRelation(relation);
    await controller.linkRecords(5, link);
    await controller.unlinkRecords(5, 6);
    await controller.removeRelation(5);
    await controller.findCharts(1);
    await controller.createChart(1, chart);
    await controller.updateChart(7, chart);
    await controller.removeChart(7);
    await controller.remove(1);

    expect(datasets.findAllDatasets.mock.calls).toEqual([[undefined], [2]]);
    expect(datasets.findOneDataset).toHaveBeenCalledWith(1);
    expect(datasets.createDataset).toHaveBeenCalledWith({
      name: 'Dataset',
      schema: [],
    });
    expect(datasets.updateDataset).toHaveBeenCalledWith(1, { name: 'Renamed' });
    expect(datasets.analyzeSchemaChange).toHaveBeenCalledWith(1, []);
    expect(datasets.resolveLinkedRecords.mock.calls).toEqual([
      [1, ['CODE'], 'code'],
      [1, [], undefined],
    ]);
    expect(datasets.createRecord).toHaveBeenCalledWith(1, data);
    expect(datasets.updateRecord).toHaveBeenCalledWith(1, 3, data);
    expect(datasets.removeRecord).toHaveBeenCalledWith(1, 3);
    expect(datasets.getLinkedRecords).toHaveBeenCalledWith(4);
    expect(datasets.bulkDeleteRecords).toHaveBeenCalledWith(1, [3, 4]);
    expect(datasets.findRelations).toHaveBeenCalledWith(1);
    expect(datasets.createRelation).toHaveBeenCalledWith(relation);
    expect(datasets.linkRecords).toHaveBeenCalledWith(5, link);
    expect(datasets.unlinkRecords).toHaveBeenCalledWith(5, 6);
    expect(datasets.removeRelation).toHaveBeenCalledWith(5);
    expect(datasets.findCharts).toHaveBeenCalledWith(1);
    expect(datasets.createChart).toHaveBeenCalledWith(1, chart);
    expect(datasets.updateChart).toHaveBeenCalledWith(7, chart);
    expect(datasets.removeChart).toHaveBeenCalledWith(7);
    expect(datasets.removeDataset).toHaveBeenCalledWith(1);
  });
});

import { DatasetExtractionService } from '../../../src/dataset/dataset-extraction.service';

describe('DatasetExtractionService', () => {
  it('creates column proposals as inference assignments', async () => {
    const resourceService = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 7, title: 'Source', name: 'source' }),
      getContentById: jest.fn().mockResolvedValue('<p>Readable content</p>'),
    };
    const executionService = {
      createInference: jest
        .fn()
        .mockResolvedValue({ executionId: 'execution-id' }),
    };
    const service = new DatasetExtractionService(
      {} as any,
      {} as any,
      resourceService as any,
      executionService as any,
    );

    await expect(service.proposeColumns([7], '42', 3)).resolves.toEqual({
      executionId: 'execution-id',
    });
    expect(executionService.createInference).toHaveBeenCalledWith(
      'dataset.propose-columns',
      expect.any(String),
      {
        projectId: 3,
        resources: [
          {
            id: 7,
            title: 'Source',
            excerpt: '<p>Readable content</p>',
          },
        ],
      },
      { ownerPrincipal: '42' },
    );
  });

  it('creates row extraction as a map-reduce workflow', async () => {
    const recordRepository = {};
    const resourceService = {
      getContentById: jest.fn().mockResolvedValue('Readable content'),
    };
    const executionService = {
      create: jest.fn().mockResolvedValue({ executionId: 'execution-id' }),
    };
    const service = new DatasetExtractionService(
      {} as any,
      recordRepository as any,
      resourceService as any,
      executionService as any,
    );

    const enqueue = (mimeType: string) =>
      (service as any).enqueueExtractionExecution(
        {
          id: 3,
          schema: [{ key: 'name', description: 'Person name' }],
          extractionConfig: { model: 'test-model' },
        },
        { id: 5 },
        {
          id: 7,
          mimeType,
          title: 'Source',
          name: 'source.txt',
        },
        ['name'],
        11,
        '42',
      );
    await expect(enqueue('Text/HTML; charset=utf-8')).resolves.toEqual({
      executionId: 'execution-id',
    });
    const [, , payload, { steps }] = executionService.create.mock.calls[0];
    expect(payload.sourcePagination).toBe('unpaginated');
    expect(steps[0].work.payload.sourcePagination).toBe('unpaginated');
    expect(executionService.create).toHaveBeenCalledWith(
      'dataset.extract-row',
      expect.any(String),
      expect.objectContaining({
        datasetId: 3,
        recordId: 5,
        resourceId: 7,
        documentText: 'Readable content',
      }),
      {
        ownerPrincipal: '42',
        steps: expect.arrayContaining([
          expect.objectContaining({
            work: expect.objectContaining({
              taskType: 'dataset.extract-row-map',
            }),
          }),
          expect.objectContaining({
            work: expect.objectContaining({
              taskType: 'dataset.extract-row-reduce',
            }),
          }),
        ]),
      },
    );

    await enqueue('application/pdf');
    const [, , pdfPayload, pdfOptions] = executionService.create.mock.calls[1];
    expect(pdfPayload).not.toHaveProperty('sourcePagination');
    expect(pdfOptions.steps[0].work.payload).not.toHaveProperty(
      'sourcePagination',
    );
  });
});

describe('Dataset extraction entry points', () => {
  const schema = [
    { key: 'name', description: 'Person name' },
    { key: 'notes', description: ' ' },
    { key: 'manual' },
  ];
  let datasets: Record<string, jest.Mock>;
  let rows: Record<string, jest.Mock>;
  let resources: Record<string, jest.Mock>;
  let executions: Record<string, jest.Mock>;
  let service: DatasetExtractionService;

  beforeEach(() => {
    datasets = { findOne: jest.fn(), save: jest.fn() };
    rows = {
      findOne: jest.fn(),
      create: jest.fn((row) => ({ id: 9, ...row })),
      save: jest.fn(async (row) => row),
    };
    resources = {
      findOne: jest.fn(),
      findByProject: jest.fn().mockResolvedValue([]),
      getContentById: jest.fn().mockResolvedValue('Readable source'),
    };
    executions = {
      create: jest.fn().mockResolvedValue({ executionId: 'queued' }),
      createInference: jest.fn().mockResolvedValue({ executionId: 'proposal' }),
    };
    service = new DatasetExtractionService(
      datasets as any,
      rows as any,
      resources as any,
      executions as any,
    );
  });

  describe('extract all rows', () => {
    it('queues matching project documents with their execution owner', async () => {
      datasets.findOne.mockResolvedValue({
        id: 1,
        project: { id: 3 },
        schema,
        sourceMode: 'project_resources',
        sourceConfig: { resourceTypeFilter: ['application/pdf'] },
        extractionConfig: { model: 'configured-model' },
      });
      resources.findByProject.mockResolvedValue([
        { id: 4, mimeType: 'audio/mpeg' },
        { id: 5 },
        { id: 6, mimeType: 'application/pdf' },
        { id: 7, mimeType: 'application/pdf' },
      ]);
      const existing = {
        id: 8,
        data: { name: 'Keep' },
        extractionStatus: 'failed',
        extractionError: 'Old',
      };
      rows.findOne.mockResolvedValueOnce(existing);
      executions.create
        .mockResolvedValueOnce({ executionId: 'first' })
        .mockResolvedValueOnce(null);
      await expect(service.extractAll(1, '7')).resolves.toEqual({
        rowsQueued: 1,
        executionIds: ['first'],
      });
      expect(resources.findByProject).toHaveBeenCalledWith(3);
      expect(rows.save).toHaveBeenNthCalledWith(1, {
        id: 8,
        data: { name: 'Keep' },
        extractionStatus: 'in_progress',
        extractionError: null,
      });
      expect(rows.save).toHaveBeenNthCalledWith(2, {
        id: 9,
        dataset: { id: 1 },
        data: {},
        cellMetadata: {},
        sourceResourceId: 7,
        extractionStatus: 'in_progress',
        extractionError: null,
      });
      expect(executions.create).toHaveBeenCalledTimes(2);
      expect(executions.create).toHaveBeenNthCalledWith(
        1,
        'dataset.extract-row',
        expect.any(String),
        expect.objectContaining({
          columnsToExtract: ['name'],
          schema: [schema[0]],
          model: 'configured-model',
          datasetId: 1,
          recordId: 8,
          resourceId: 6,
          projectId: 3,
        }),
        { ownerPrincipal: '7', steps: expect.any(Array) },
      );
      expect(datasets.save).toHaveBeenCalledWith(
        expect.objectContaining({
          extractionConfig: {
            model: 'configured-model',
            promptVersion: expect.any(String),
            lastRunAt: expect.any(String),
          },
        }),
      );
    });

    it('captures only the authorized resource in a batch', async () => {
      const dataset = {
        id: 1,
        schema,
        project: { id: 3 },
        sourceMode: 'resource_selection',
        sourceConfig: { resourceIds: [7] },
      };
      datasets.findOne.mockResolvedValue(dataset);
      resources.findOne.mockImplementation(async (id) => ({
        id,
        project: { id: 3 },
        mimeType: 'Text/HTML; charset=utf-8',
      }));

      await expect(service.extractAll(1, '7', 8)).rejects.toThrow(
        'does not match the authorized resource',
      );
      expect(rows.save).not.toHaveBeenCalled();
      expect(executions.create).not.toHaveBeenCalled();

      dataset.sourceConfig.resourceIds = [7, 8, 9];
      await expect(service.extractAll(1, '7', 7)).resolves.toEqual({
        rowsQueued: 3,
        executionIds: ['queued', 'queued', 'queued'],
      });
      expect(executions.create).toHaveBeenNthCalledWith(
        1,
        'dataset.extract-row',
        expect.any(String),
        expect.objectContaining({
          resourceId: 7,
          sourcePagination: 'unpaginated',
          isAudio: false,
        }),
        {
          ownerPrincipal: '7',
          steps: expect.any(Array),
          captureInference: true,
        },
      );
      for (const [index, resourceId] of [8, 9].entries()) {
        expect(executions.create).toHaveBeenNthCalledWith(
          index + 2,
          'dataset.extract-row',
          expect.any(String),
          expect.objectContaining({ resourceId }),
          { ownerPrincipal: '7', steps: expect.any(Array) },
        );
      }
    });

    it('validates dataset mode and resource ownership and skips empty selections', async () => {
      await expect(service.extractAll(1, '7')).rejects.toThrow(
        'Dataset with id 1 not found',
      );
      datasets.findOne
        .mockResolvedValueOnce({ sourceMode: 'manual' })
        .mockResolvedValueOnce({ sourceMode: 'project_resources' })
        .mockResolvedValueOnce({
          sourceMode: 'project_resources',
          project: { id: 3 },
        })
        .mockResolvedValueOnce({ sourceMode: 'resource_selection' })
        .mockResolvedValue({
          sourceMode: 'resource_selection',
          project: { id: 3 },
          sourceConfig: { resourceIds: [7] },
        });
      await expect(service.extractAll(1, '7')).rejects.toThrow(
        'Cannot extract from a manual dataset',
      );
      await expect(service.extractAll(1, '7')).rejects.toThrow(
        'requires the dataset to belong to a project',
      );
      await expect(service.extractAll(1, '7')).resolves.toEqual({
        rowsQueued: 0,
        executionIds: [],
      });
      await expect(service.extractAll(1, '7')).resolves.toEqual({
        rowsQueued: 0,
        executionIds: [],
      });
      await expect(service.extractAll(1, '7')).rejects.toThrow(
        'selected resources do not exist',
      );
      resources.findOne.mockResolvedValue({ id: 7, project: { id: 4 } });
      await expect(service.extractAll(1, '7')).rejects.toThrow(
        "Resource 7 does not belong to the dataset's project",
      );
      expect(executions.create).not.toHaveBeenCalled();
    });
  });

  describe('re-extraction', () => {
    it('rejects missing datasets, rows, resources and manually created rows', async () => {
      await expect(service.extractRow(1, 2, '7')).rejects.toThrow(
        'Dataset with id 1 not found',
      );
      datasets.findOne.mockResolvedValue({ id: 1, schema });
      await expect(service.extractRow(1, 2, '7')).rejects.toThrow(
        'Record with id 2 not found',
      );
      rows.findOne
        .mockResolvedValueOnce({ id: 2 })
        .mockResolvedValueOnce({ id: 2, sourceResourceId: 3 });
      await expect(service.extractRow(1, 2, '7')).rejects.toThrow(
        'Cannot re-extract a manually created row',
      );
      await expect(service.extractRow(1, 2, '7')).rejects.toThrow(
        'Resource with id 3 not found',
      );
      expect(rows.findOne).toHaveBeenCalledWith({
        where: { id: 2, dataset: { id: 1 } },
      });
      expect(rows.save).not.toHaveBeenCalled();
      expect(executions.create).not.toHaveBeenCalled();
    });

    it('retries rows with chosen columns and clears old errors', async () => {
      datasets.findOne.mockResolvedValue({ id: 1, schema });
      rows.findOne.mockResolvedValue({
        id: 2,
        sourceResourceId: 3,
        extractionStatus: 'failed',
        extractionError: 'old',
      });
      resources.findOne.mockResolvedValue({
        id: 3,
        name: 'Original',
        mimeType: 'Audio/MP3; parameter=x',
      });
      await expect(service.extractRow(1, 2, '7', [])).resolves.toEqual({
        executionId: 'queued',
      });
      expect(rows.save).toHaveBeenCalledWith(
        expect.objectContaining({
          extractionStatus: 'in_progress',
          extractionError: null,
        }),
      );
      expect(executions.create.mock.calls[0][2]).toMatchObject({
        columnsToExtract: ['name'],
        sourceTitle: 'Original',
        isAudio: true,
        projectId: null,
      });
      executions.create.mockResolvedValueOnce(null);
      await expect(service.extractRow(1, 2, '7', ['manual'])).resolves.toEqual({
        executionId: null,
      });
      expect(executions.create.mock.calls[1][2]).toMatchObject({
        columnsToExtract: ['manual'],
      });
    });

    it('requires confirmation for edited cells unless forced', async () => {
      datasets.findOne.mockResolvedValue({ id: 1, schema, project: { id: 4 } });
      rows.findOne.mockResolvedValue({
        id: 2,
        sourceResourceId: 3,
        cellMetadata: { name: { editedByUser: true } },
      });
      resources.findOne.mockResolvedValue({ id: 3, title: 'Page' });
      resources.getContentById.mockResolvedValue(null);
      await expect(service.extractCell(1, 2, 'missing', '7')).rejects.toThrow(
        "Field 'missing' is not in the dataset schema",
      );
      await expect(service.extractCell(1, 2, 'name', '7')).resolves.toEqual({
        requiresConfirmation: true,
        reason: 'cell_edited_by_user',
      });
      expect(executions.create).not.toHaveBeenCalled();
      await expect(
        service.extractCell(1, 2, 'name', '7', { force: true }),
      ).resolves.toEqual({ executionId: 'queued' });
      expect(executions.create.mock.calls[0][2]).toMatchObject({
        columnsToExtract: ['name'],
        projectId: 4,
        sourceTitle: 'Page',
        isAudio: false,
        documentText: '',
      });
      expect(rows.save).not.toHaveBeenCalled();
    });
  });

  it('caps column proposals to three sources and 2,000 characters per source', async () => {
    resources.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ name: 'Second' })
      .mockResolvedValueOnce({});
    resources.getContentById
      .mockResolvedValueOnce('a'.repeat(2100))
      .mockResolvedValueOnce(null);
    await expect(service.proposeColumns([1, 2, 3, 4], '7')).resolves.toEqual({
      executionId: 'proposal',
    });
    expect(resources.findOne.mock.calls).toEqual([[1], [2], [3]]);
    expect(executions.createInference.mock.calls[0][2]).toEqual({
      projectId: null,
      resources: [
        { id: 2, title: 'Second', excerpt: 'a'.repeat(2000) },
        { id: 3, title: 'resource 3', excerpt: '' },
      ],
    });
  });

  it('rejects empty source lists or proposals without readable excerpts', async () => {
    await expect(service.proposeColumns([], '7')).rejects.toThrow(
      'must be non-empty',
    );
    await expect(service.proposeColumns([1], '7')).rejects.toThrow(
      'no readable content',
    );
    resources.findOne.mockResolvedValue({ id: 1 });
    resources.getContentById.mockResolvedValue('   ');
    await expect(service.proposeColumns([1], '7')).rejects.toThrow(
      'no readable content',
    );
    expect(executions.createInference).not.toHaveBeenCalled();
  });
});

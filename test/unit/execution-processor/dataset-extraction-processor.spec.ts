import { DatasetExtractionProcessor } from '../../../src/execution-processor/processors/dataset-extraction-processor';
import { ExecutionEntity } from '../../../src/execution/execution.entity';

describe('DatasetExtractionProcessor', () => {
  it('reconciles a failed inference onto the dataset row', async () => {
    const record = {
      id: 5,
      dataset: { id: 3 },
      data: {},
      cellMetadata: {},
      extractionStatus: 'in_progress',
      extractionError: null,
    };
    const repository = {
      findOne: jest.fn().mockImplementation(async () => record),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const manager = { getRepository: jest.fn().mockReturnValue(repository) };
    const effectJournal = {
      runVerified: jest.fn(async (_input, callback) => ({
        applied: true,
        observation: await callback(manager),
      })),
    };
    const processor = new DatasetExtractionProcessor(effectJournal as any);
    const execution = {
      executionId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
      taskType: 'dataset.extract-row',
      payload: { datasetId: 3, recordId: 5, columnsToExtract: ['name'] },
      phase: 'domain_failure_finalization',
      result: null,
      error: { code: 'STEP_EXECUTION_FAILED', message: 'Model failed' },
    } as ExecutionEntity;

    await expect(processor.process(execution)).resolves.toEqual(
      expect.objectContaining({
        success: false,
        message: 'Model failed',
        publication: expect.objectContaining({
          payload: expect.objectContaining({
            extractionStatus: 'failed',
            recordId: 5,
          }),
        }),
      }),
    );
    expect(record.extractionStatus).toBe('failed');
    expect(record.extractionError).toBe('Model failed');
    expect(effectJournal.runVerified).toHaveBeenCalledWith(
      expect.objectContaining({
        effectKey: 'dataset-extraction:5',
        effectType: 'dataset_record_extraction_replace',
      }),
      expect.any(Function),
    );
  });

  it('applies a structured extraction result without a domain error field', async () => {
    const record = {
      id: 5,
      dataset: { id: 3 },
      data: { preserved: true },
      cellMetadata: {},
      extractionStatus: 'in_progress',
      extractionError: null,
    };
    const repository = {
      findOne: jest.fn().mockImplementation(async () => record),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const manager = { getRepository: jest.fn().mockReturnValue(repository) };
    const effectJournal = {
      runVerified: jest.fn(async (_input, callback) => ({
        applied: true,
        observation: await callback(manager),
      })),
    };
    const processor = new DatasetExtractionProcessor(effectJournal as any);
    const result = {
      data: { name: 'Ada' },
      cellMetadata: { name: { quote: 'Ada' } },
      model: 'test-model',
      promptVersion: 'prompt/1',
    };
    const execution = {
      executionId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
      taskType: 'dataset.extract-row',
      payload: { datasetId: 3, recordId: 5, columnsToExtract: ['name'] },
      phase: 'domain_finalization',
      result,
      error: null,
    } as ExecutionEntity;

    await expect(processor.process(execution)).resolves.toEqual(
      expect.objectContaining({ success: true }),
    );
    expect(record).toEqual(
      expect.objectContaining({
        data: { preserved: true, name: 'Ada' },
        cellMetadata: { name: { quote: 'Ada' } },
        extractionStatus: 'extracted',
        extractionError: null,
      }),
    );
  });
});

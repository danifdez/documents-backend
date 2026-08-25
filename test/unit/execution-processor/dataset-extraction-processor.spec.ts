import { DatasetExtractionProcessor } from '../../../src/execution-processor/processors/dataset-extraction-processor';
import { ExecutionEntity } from '../../../src/execution/execution.entity';

describe('DatasetExtractionProcessor', () => {
  it('reconciles a failed inference onto the dataset row', async () => {
    const extractionService = {
      markExtractionFailed: jest.fn().mockResolvedValue({
        datasetId: 3,
        status: 'failed',
      }),
      applyExtractionResult: jest.fn(),
    };
    const processor = new DatasetExtractionProcessor(extractionService as any);
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
    expect(extractionService.markExtractionFailed).toHaveBeenCalledWith(
      5,
      'Model failed',
    );
    expect(extractionService.applyExtractionResult).not.toHaveBeenCalled();
  });

  it('applies a structured extraction result without a domain error field', async () => {
    const extractionService = {
      markExtractionFailed: jest.fn(),
      applyExtractionResult: jest.fn().mockResolvedValue({
        datasetId: 3,
        status: 'extracted',
      }),
    };
    const processor = new DatasetExtractionProcessor(extractionService as any);
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
    expect(extractionService.applyExtractionResult).toHaveBeenCalledWith(
      5,
      result,
      ['name'],
    );
    expect(extractionService.markExtractionFailed).not.toHaveBeenCalled();
  });
});

import { IndexedFileExtractionProcessor } from '../../../src/execution-processor/processors/indexed-file-extraction-processor'; // eslint-disable-line max-len
import { ExecutionEntity } from '../../../src/execution/execution.entity';
import { IndexedFileEntity } from '../../../src/indexed-file/indexed-file.entity';

describe('IndexedFileExtractionProcessor', () => {
  it('journals extracted text and creates one idempotent ingest child', async () => {
    const file = {
      id: 7,
      ownerType: 'agent',
      ownerId: 3,
      filename: 'report.pdf',
      checksum: 'checksum-a',
      extractedText: null,
    };
    const repository = {
      findOne: jest.fn().mockResolvedValue(file),
    };
    const transactionalRepository = {
      findOne: jest.fn().mockResolvedValue(file),
      save: jest.fn(async (value) => value),
      findOneBy: jest.fn().mockImplementation(async () => file),
    };
    const manager = {
      getRepository: jest.fn((entity) => {
        expect(entity).toBe(IndexedFileEntity);
        return transactionalRepository;
      }),
    };
    const effectJournal = {
      runVerified: jest.fn(async (_input, callback) => ({
        applied: true,
        observation: await callback(manager),
      })),
    };
    const executions = {
      createChildInferenceOnce: jest.fn().mockResolvedValue({}),
    };
    const processor = new IndexedFileExtractionProcessor(
      repository as any,
      executions as any,
      effectJournal as any,
    );
    const execution = {
      executionId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
      lastEventId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca702',
      payload: { indexedFileId: 7, checksum: 'checksum-a' },
      result: { content: 'Extracted report' },
    } as ExecutionEntity;

    await expect(processor.process(execution)).resolves.toEqual({
      success: true,
      indexedFileId: 7,
      length: 16,
    });

    expect(effectJournal.runVerified).toHaveBeenCalledWith(
      expect.objectContaining({
        effectKey: 'indexed-file-extraction:7',
        effectType: 'indexed_file_text_replace',
        intent: {
          indexedFileId: 7,
          checksum: 'checksum-a',
          text: 'Extracted report',
        },
      }),
      expect.any(Function),
    );
    expect(executions.createChildInferenceOnce).toHaveBeenCalledWith(
      execution.executionId,
      'indexed-file-extraction:ingest:7:checksum-a',
      expect.objectContaining({
        taskType: 'indexed-file-ingest',
        payload: {
          indexedFileId: 7,
          ownerType: 'agent',
          ownerId: 3,
          content: 'Extracted report',
          filename: 'report.pdf',
          checksum: 'checksum-a',
        },
        causedByEventId: execution.lastEventId,
      }),
    );
  });
});

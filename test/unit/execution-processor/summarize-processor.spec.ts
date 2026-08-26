import { SummarizeProcessor } from '../../../src/execution-processor/processors/summarize-processor'; // eslint-disable-line max-len
import { ExecutionEntity } from '../../../src/execution/execution.entity';
import { DocEntity } from '../../../src/doc/doc.entity';

describe('SummarizeProcessor', () => {
  it('appends a document summary through the verified effect journal', async () => {
    const documents = {
      findOne: jest.fn().mockResolvedValue({ id: 7, content: 'Original' }),
      save: jest.fn(async (doc) => doc),
      findOneBy: jest
        .fn()
        .mockResolvedValue({ id: 7, content: 'Original\n\nSummary' }),
    };
    const manager = {
      getRepository: jest.fn((entity) => {
        expect(entity).toBe(DocEntity);
        return documents;
      }),
    };
    const effectJournal = {
      runVerified: jest.fn(async (_input, callback) => ({
        applied: true,
        observation: await callback(manager),
      })),
    };
    const processor = new SummarizeProcessor({} as any, effectJournal as any);
    const execution = {
      executionId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
      taskType: 'summarize',
      payload: { targetDocId: 7 },
      result: { response: 'Summary' },
    } as ExecutionEntity;

    await expect(processor.process(execution)).resolves.toEqual(
      expect.objectContaining({ success: true }),
    );

    expect(effectJournal.runVerified).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: execution.executionId,
        effectKey: 'summarize-document-append:7',
        effectType: 'document_content_append',
        resourceKey: 'document:7',
        intent: { targetDocId: 7, summary: 'Summary' },
      }),
      expect.any(Function),
    );
    expect(documents.save).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Original\n\nSummary' }),
    );
  });
});

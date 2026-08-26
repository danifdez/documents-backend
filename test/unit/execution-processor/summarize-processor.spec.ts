import { SummarizeProcessor } from '../../../src/execution-processor/processors/summarize-processor'; // eslint-disable-line max-len
import { ExecutionEntity } from '../../../src/execution/execution.entity';
import { DocEntity } from '../../../src/doc/doc.entity';
import { ResourceEntity } from '../../../src/resource/resource.entity';

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
    const processor = new SummarizeProcessor(effectJournal as any);
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

  it('replaces a resource summary through the verified effect journal', async () => {
    const resources = {
      findOne: jest.fn().mockResolvedValue({ id: 9, summary: 'Previous' }),
      save: jest.fn(async (resource) => resource),
      findOneBy: jest.fn().mockResolvedValue({ id: 9, summary: 'Summary' }),
    };
    const manager = {
      getRepository: jest.fn((entity) => {
        expect(entity).toBe(ResourceEntity);
        return resources;
      }),
    };
    const effectJournal = {
      runVerified: jest.fn(async (_input, callback) => ({
        applied: true,
        observation: await callback(manager),
      })),
    };
    const processor = new SummarizeProcessor(effectJournal as any);
    const execution = {
      executionId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca702',
      taskType: 'summarize',
      payload: { resourceId: 9 },
      result: { response: 'Summary' },
    } as ExecutionEntity;

    await expect(processor.process(execution)).resolves.toEqual(
      expect.objectContaining({ success: true }),
    );

    expect(effectJournal.runVerified).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: execution.executionId,
        effectKey: 'summarize-resource-replace:9',
        effectType: 'resource_summary_replace',
        resourceKey: 'resource:9',
        intent: { resourceId: 9, summary: 'Summary' },
      }),
      expect.any(Function),
    );
    expect(resources.save).toHaveBeenCalledWith(
      expect.objectContaining({ summary: 'Summary' }),
    );
  });
});

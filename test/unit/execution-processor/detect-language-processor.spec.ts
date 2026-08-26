import { DetectLanguageProcessor } from '../../../src/execution-processor/processors/detect-language-processor'; // eslint-disable-line max-len
import { ExecutionEntity } from '../../../src/execution/execution.entity';
import { ResourceEntity } from '../../../src/resource/resource.entity';

describe('DetectLanguageProcessor', () => {
  it('journals the resource update and creates idempotent child work', async () => {
    const content = '<p>Hello world</p>';
    const resource = {
      id: 7,
      project: { id: 3 },
      publicationDate: '2026-08-20',
      content,
      language: null,
      status: 'detecting-language',
    };
    const resources = {
      findOne: jest.fn().mockResolvedValue(resource),
      getContentById: jest.fn().mockResolvedValue(content),
    };
    const transactionalRepository = {
      findOne: jest.fn().mockResolvedValue(resource),
      save: jest.fn().mockResolvedValue(resource),
      findOneBy: jest.fn().mockImplementation(async () => resource),
    };
    const manager = {
      getRepository: jest.fn((entity) => {
        expect(entity).toBe(ResourceEntity);
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
      create: jest.fn().mockResolvedValue({}),
    };
    const processor = new DetectLanguageProcessor(
      resources as any,
      executions as any,
      effectJournal as any,
    );
    const execution = {
      executionId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca704',
      rootExecutionId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
      lastEventId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca705',
      payload: { resourceId: 7 },
      result: { results: [{ language: 'en' }, { language: 'en' }] },
    } as ExecutionEntity;

    await expect(processor.process(execution)).resolves.toEqual({
      success: true,
      resourceId: 7,
      detectedLanguage: 'en',
    });

    expect(effectJournal.runVerified).toHaveBeenCalledWith(
      expect.objectContaining({
        effectKey: 'detect-language:7',
        effectType: 'resource_language_replace',
      }),
      expect.any(Function),
    );
    expect(resource).toEqual(
      expect.objectContaining({ language: 'en', status: 'ready' }),
    );
    expect(executions.createChildInferenceOnce).toHaveBeenCalledWith(
      execution.executionId,
      expect.stringMatching(/^detect-language:ingest-content:7:sha256:/),
      expect.objectContaining({
        taskType: 'ingest-content',
        causedByEventId: execution.lastEventId,
      }),
    );
    expect(executions.create).toHaveBeenCalledWith(
      'date-extraction',
      'normal',
      expect.objectContaining({
        resourceId: 7,
        detectedLanguage: 'en',
        anchorDate: '2026-08-20',
      }),
      expect.objectContaining({
        rootExecutionId: execution.rootExecutionId,
        parentExecutionId: execution.executionId,
        childIdempotencyKey: expect.stringMatching(
          /^detect-language:date-extraction:7:sha256:/,
        ),
        steps: expect.any(Array),
      }),
    );
  });
});

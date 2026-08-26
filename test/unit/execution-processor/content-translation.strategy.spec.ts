import { ContentTranslationStrategy } from '../../../src/execution-processor/processors/translate/content-translation.strategy'; // eslint-disable-line max-len
import { ExecutionEntity } from '../../../src/execution/execution.entity';
import { ResourceEntity } from '../../../src/resource/resource.entity';

describe('ContentTranslationStrategy', () => {
  it('persists translated content through the verified effect journal', async () => {
    const resource = {
      id: 7,
      content: '<p>Hello</p>',
      translatedContent: null,
    };
    const resources = {
      findOne: jest.fn().mockResolvedValue(resource),
      save: jest.fn(async (value) => value),
      findOneBy: jest.fn().mockImplementation(async () => resource),
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
    const strategy = new ContentTranslationStrategy(effectJournal as any);
    const execution = {
      executionId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
      payload: { resourceId: 7 },
      result: {
        response: [
          {
            path: 'p',
            original_text: 'Hello',
            translation_text: 'Hola',
          },
        ],
      },
    } as ExecutionEntity;

    await expect(strategy.execute(execution)).resolves.toEqual({
      success: true,
    });

    expect(effectJournal.runVerified).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: execution.executionId,
        effectKey: 'content-translation-resource-replace:7',
        effectType: 'resource_translated_content_replace',
        resourceKey: 'resource:7',
        intent: {
          resourceId: 7,
          translations: execution.result.response,
        },
      }),
      expect.any(Function),
    );
    expect(resources.save).toHaveBeenCalledWith(
      expect.objectContaining({ translatedContent: '<p>Hola</p>' }),
    );
  });
});

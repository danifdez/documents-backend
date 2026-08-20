import { ModelService } from '../../../src/model/model.service';

describe('ModelService execution identities', () => {
  const executionIds = {
    summarize: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
    translate: '018f1d8a-54d7-7d63-a1ee-5e9a6adca702',
    'entity-extraction': '018f1d8a-54d7-7d63-a1ee-5e9a6adca703',
    'key-point': '018f1d8a-54d7-7d63-a1ee-5e9a6adca704',
    keywords: '018f1d8a-54d7-7d63-a1ee-5e9a6adca705',
  };
  let executionService: { create: jest.Mock };
  let resourceService: {
    findOne: jest.Mock;
    getContentById: jest.Mock;
    getTranslatedContentById: jest.Mock;
  };
  let service: ModelService;

  beforeEach(() => {
    delete process.env.AGENT_ENTITY_EXTRACTION;
    executionService = {
      create: jest.fn(async (taskType: keyof typeof executionIds) => ({
        executionId: executionIds[taskType],
      })),
    };
    resourceService = {
      findOne: jest.fn().mockResolvedValue({ language: 'es' }),
      getContentById: jest.fn().mockResolvedValue('<p>Hola mundo</p>'),
      getTranslatedContentById: jest.fn().mockResolvedValue(null),
    };
    service = new ModelService(executionService as any, resourceService as any);
  });

  it.each([
    [
      'summarize',
      () =>
        service.summarize(
          'en',
          undefined,
          undefined,
          'Hola',
          'es',
          'workspace-selection',
        ),
    ],
    ['translate', () => service.translate(7, 'en')],
    ['entity-extraction', () => service.extractEntities(7)],
    ['key-point', () => service.keyPoints(7, 'en')],
    ['keywords', () => service.keywords(7, 'en')],
  ] as const)('returns the UUID of the %s execution', async (taskType, run) => {
    await expect(run()).resolves.toEqual({
      executionId: executionIds[taskType],
    });
    expect(executionService.create).toHaveBeenCalledWith(
      taskType,
      expect.any(String),
      expect.any(Object),
      ...(taskType === 'entity-extraction' ? [undefined] : []),
    );
  });
});

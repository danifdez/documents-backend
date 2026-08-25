import { ModelService } from '../../../src/model/model.service';
import { buildSummarizeWorkflowSteps } from '../../../src/model/summarize-workflow';
import { buildEntityExtractionWorkflowSteps } from '../../../src/model/entity-extraction-workflow';
import { buildKeywordsWorkflowSteps } from '../../../src/model/keywords-workflow';

describe('ModelService execution identities', () => {
  const executionIds = {
    summarize: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
    translate: '018f1d8a-54d7-7d63-a1ee-5e9a6adca702',
    'entity-extraction': '018f1d8a-54d7-7d63-a1ee-5e9a6adca703',
    'key-point': '018f1d8a-54d7-7d63-a1ee-5e9a6adca704',
    keywords: '018f1d8a-54d7-7d63-a1ee-5e9a6adca705',
  };
  let executionService: { create: jest.Mock; createInference: jest.Mock };
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
      createInference: jest.fn(async (taskType: keyof typeof executionIds) => ({
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

  it.each([['key-point', () => service.keyPoints(7, 'en')]] as const)(
    'returns the UUID of the %s execution',
    async (taskType, run) => {
      await expect(run()).resolves.toEqual({
        executionId: executionIds[taskType],
      });
      expect(executionService.create).toHaveBeenCalledWith(
        taskType,
        expect.any(String),
        expect.any(Object),
      );
    },
  );

  it('creates keywords as a durable map-reduce step graph', async () => {
    await expect(service.keywords(7, 'en')).resolves.toEqual({
      executionId: executionIds.keywords,
    });
    expect(executionService.create).toHaveBeenCalledWith(
      'keywords',
      expect.any(String),
      { resourceId: 7, targetLanguage: 'en', chunkCount: 1 },
      {
        steps: [
          expect.objectContaining({
            stepKind: 'inference',
            requiredCapabilities: ['keywords-map'],
          }),
          expect.objectContaining({
            stepKind: 'code',
            requiredCapabilities: ['keywords-reduce'],
            operationKind: 'artifact_processing',
            recoveryClass: 'read_only_replayable',
          }),
        ],
      },
    );
  });

  it('creates entity extraction as a durable map-reduce step graph', async () => {
    await expect(service.extractEntities(7)).resolves.toEqual({
      executionId: executionIds['entity-extraction'],
    });
    expect(executionService.create).toHaveBeenCalledWith(
      'entity-extraction',
      expect.any(String),
      { resourceId: 7, chunkCount: 1 },
      {
        steps: [
          expect.objectContaining({
            stepKind: 'inference',
            requiredCapabilities: ['entity-extraction-map'],
          }),
          expect.objectContaining({
            stepKind: 'code',
            requiredCapabilities: ['entity-extraction-reduce'],
            operationKind: 'artifact_processing',
            recoveryClass: 'read_only_replayable',
          }),
        ],
      },
    );
  });

  it('creates translate as an inference assignment', async () => {
    await expect(service.translate(7, 'en')).resolves.toEqual({
      executionId: executionIds.translate,
    });
    expect(executionService.createInference).toHaveBeenCalledWith(
      'translate',
      expect.any(String),
      expect.objectContaining({
        sourceLanguage: 'es',
        targetLanguage: 'en',
        texts: expect.any(Array),
      }),
    );
  });

  it('creates summarize as a durable map-reduce step graph', async () => {
    await expect(
      service.summarize(
        'en',
        undefined,
        undefined,
        'Hola',
        'es',
        'workspace-selection',
      ),
    ).resolves.toEqual({ executionId: executionIds.summarize });

    expect(executionService.create).toHaveBeenCalledWith(
      'summarize',
      expect.any(String),
      expect.objectContaining({
        targetLanguage: 'en',
        sourceLanguage: 'es',
      }),
      {
        steps: [
          expect.objectContaining({
            stepKind: 'inference',
            requiredCapabilities: ['summarize-map'],
          }),
          expect.objectContaining({
            stepKind: 'inference',
            requiredCapabilities: ['summarize-reduce'],
          }),
        ],
      },
    );
  });

  it('fans long summaries out into parallel map steps and one reduce', () => {
    const content = Array.from(
      { length: 1_501 },
      (_, index) => `word-${index}`,
    ).join(' ');

    const steps = buildSummarizeWorkflowSteps(content, 'en', 'es');

    expect(steps).toHaveLength(3);
    expect(steps.slice(0, 2)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ requiredCapabilities: ['summarize-map'] }),
      ]),
    );
    expect(steps[2]).toEqual(
      expect.objectContaining({
        dependsOnStepIds: [steps[0].stepId, steps[1].stepId],
        requiredCapabilities: ['summarize-reduce'],
      }),
    );
  });

  it('fans long entity documents out into map steps and deterministic reduce', () => {
    const text = Array.from(
      { length: 1_501 },
      (_, index) => `word-${index}`,
    ).join(' ');

    const steps = buildEntityExtractionWorkflowSteps([{ text }]);

    expect(steps).toHaveLength(3);
    expect(steps.slice(0, 2)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepKind: 'inference',
          requiredCapabilities: ['entity-extraction-map'],
        }),
      ]),
    );
    expect(steps[2]).toEqual(
      expect.objectContaining({
        stepKind: 'code',
        dependsOnStepIds: [steps[0].stepId, steps[1].stepId],
        requiredCapabilities: ['entity-extraction-reduce'],
      }),
    );
  });

  it('fans long keyword documents out into map steps and deterministic reduce', () => {
    const text = Array.from(
      { length: 1_501 },
      (_, index) => `word-${index}`,
    ).join(' ');

    const steps = buildKeywordsWorkflowSteps([{ text }], 'es');

    expect(steps).toHaveLength(3);
    expect(steps.slice(0, 2)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepKind: 'inference',
          requiredCapabilities: ['keywords-map'],
        }),
      ]),
    );
    expect(steps[2]).toEqual(
      expect.objectContaining({
        stepKind: 'code',
        dependsOnStepIds: [steps[0].stepId, steps[1].stepId],
        requiredCapabilities: ['keywords-reduce'],
      }),
    );
  });
});

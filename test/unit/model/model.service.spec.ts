import { ModelService } from '../../../src/model/model.service';
import { buildSummarizeWorkflowSteps } from '../../../src/model/summarize-workflow';
import { buildEntityExtractionWorkflowSteps } from '../../../src/model/entity-extraction-workflow';
import { buildKeywordsWorkflowSteps } from '../../../src/model/keywords-workflow';
import { buildKeyPointWorkflowSteps } from '../../../src/model/key-point-workflow';
import { contentHash } from '../../../src/execution/execution-canonical';

describe('ModelService execution identities', () => {
  const executionIds = {
    summarize: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
    translate: '018f1d8a-54d7-7d63-a1ee-5e9a6adca702',
    'entity-extraction': '018f1d8a-54d7-7d63-a1ee-5e9a6adca703',
    'key-point': '018f1d8a-54d7-7d63-a1ee-5e9a6adca704',
    keywords: '018f1d8a-54d7-7d63-a1ee-5e9a6adca705',
    ask: '018f1d8a-54d7-7d63-a1ee-5e9a6adca706',
    search: '018f1d8a-54d7-7d63-a1ee-5e9a6adca707',
  };
  let executionService: { create: jest.Mock; createInference: jest.Mock };
  let resourceService: {
    findOne: jest.Mock;
    getContentById: jest.Mock;
    getTranslatedContentById: jest.Mock;
  };
  let service: ModelService;
  let vectorStore: Record<string, jest.Mock>;
  let graphService: Record<string, jest.Mock>;

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
    vectorStore = {
      workspaceCandidates: jest.fn().mockResolvedValue([]),
      vectorCandidatesArtifact: jest.fn().mockReturnValue({
        role: 'vector_candidates',
        kind: 'vector_candidates',
        mediaType: 'application/json',
        body: Buffer.from('{"candidates":[]}'),
      }),
    };
    graphService = {
      queryNeighborhoodForText: jest.fn().mockResolvedValue({
        entities: [],
        relationships: [],
      }),
    };
    service = new ModelService(
      executionService as any,
      resourceService as any,
      vectorStore as any,
      graphService as any,
    );
  });

  it('creates key points as a durable inference map-reduce graph', async () => {
    await expect(service.keyPoints(7, 'en')).resolves.toEqual({
      executionId: executionIds['key-point'],
    });
    expect(executionService.create).toHaveBeenCalledWith(
      'key-point',
      expect.any(String),
      { resourceId: 7, targetLanguage: 'en', chunkCount: 1 },
      {
        steps: [
          expect.objectContaining({
            stepKind: 'inference',
            requiredCapabilities: ['key-point-map'],
          }),
          expect.objectContaining({
            stepKind: 'inference',
            requiredCapabilities: ['key-point-reduce'],
          }),
        ],
      },
    );
  });

  it('freezes vector and graph context before creating ask work', async () => {
    await expect(
      service.ask('Who designed it?', 3, 'request-1'),
    ).resolves.toEqual({ executionId: executionIds.ask });
    expect(vectorStore.workspaceCandidates).toHaveBeenCalledWith(3);
    expect(graphService.queryNeighborhoodForText).toHaveBeenCalledWith(
      'Who designed it?',
      3,
    );
    expect(executionService.createInference).toHaveBeenCalledWith(
      'ask',
      expect.any(String),
      expect.objectContaining({
        question: 'Who designed it?',
        projectId: 3,
        graphContext: [],
      }),
      expect.objectContaining({ inputArtifacts: [expect.any(Object)] }),
    );
  });

  it('freezes scoped vector candidates for semantic search', async () => {
    await expect(
      service.semanticSearch('engine', 3, 'request-2', 4),
    ).resolves.toEqual({ executionId: executionIds.search });
    expect(vectorStore.workspaceCandidates).toHaveBeenCalledWith(3);
    expect(executionService.create).toHaveBeenCalledWith(
      'search',
      expect.any(String),
      { query: 'engine', projectId: 3, requestId: 'request-2', limit: 4 },
      expect.objectContaining({ inputArtifacts: [expect.any(Object)] }),
    );
  });

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
      {
        resourceId: 7,
        chunkCount: 1,
        sourceContentHash: contentHash('<p>Hola mundo</p>'),
        sourceLanguage: 'es',
      },
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

  it('fans long key-point documents out into maps and one inference reduce', () => {
    const text = Array.from(
      { length: 1_501 },
      (_, index) => `word-${index}`,
    ).join(' ');

    const steps = buildKeyPointWorkflowSteps([{ text }], 'es');

    expect(steps).toHaveLength(3);
    expect(steps.slice(0, 2)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepKind: 'inference',
          requiredCapabilities: ['key-point-map'],
        }),
      ]),
    );
    expect(steps[2]).toEqual(
      expect.objectContaining({
        stepKind: 'inference',
        dependsOnStepIds: [steps[0].stepId, steps[1].stepId],
        requiredCapabilities: ['key-point-reduce'],
      }),
    );
  });
});

import { randomUUID } from 'node:crypto';
import { ModelService } from '../../../src/model/model.service';
import { buildSummarizeWorkflowSteps } from '../../../src/model/summarize-workflow';
import { buildEntityExtractionWorkflowSteps } from '../../../src/model/entity-extraction-workflow';
import { buildKeywordsWorkflowSteps } from '../../../src/model/keywords-workflow';
import { buildKeyPointWorkflowSteps } from '../../../src/model/key-point-workflow';
import { contentHash } from '../../../src/execution/execution-canonical';

describe('ModelService execution identities', () => {
  const scope = { ownerPrincipal: 'user-7' };
  const executionIds = {
    summarize: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
    translate: '018f1d8a-54d7-7d63-a1ee-5e9a6adca702',
    'entity-extraction': '018f1d8a-54d7-7d63-a1ee-5e9a6adca703',
    'key-point': randomUUID(),
    keywords: randomUUID(),
    ask: '018f1d8a-54d7-7d63-a1ee-5e9a6adca706',
    search: '018f1d8a-54d7-7d63-a1ee-5e9a6adca707',
    'browser-inference': '018f1d8a-54d7-7d63-a1ee-5e9a6adca708',
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

  it('routes connected browser inference through a scoped durable step', async () => {
    const requestJson = '{"messages":[{"role":"user","content":"Hi"}]}';
    await expect(
      service.browserInference(
        {
          requestId: '11111111-1111-4111-8111-111111111111',
          requestJson,
          label: 'chat',
          detail: 'page',
        },
        { ownerPrincipal: 'user-7' },
      ),
    ).resolves.toEqual({ executionId: executionIds['browser-inference'] });
    expect(executionService.createInference).toHaveBeenCalledWith(
      'browser-inference',
      expect.any(String),
      { requestJson, label: 'chat', detail: 'page' },
      {
        ownerPrincipal: 'user-7',
        finalizeOnFailure: true,
        requestId: '11111111-1111-4111-8111-111111111111',
      },
    );
  });

  it('passes an explicit capture grant to the existing inference mechanism', async () => {
    const request = {
      requestId: '11111111-1111-4111-8111-111111111111',
      requestJson: '{"messages":[]}',
    };
    await service.browserInference(request, scope, true);
    expect(executionService.createInference).toHaveBeenCalledWith(
      'browser-inference',
      expect.any(String),
      expect.any(Object),
      {
        ownerPrincipal: scope.ownerPrincipal,
        finalizeOnFailure: true,
        requestId: request.requestId,
        captureInference: true,
      },
    );
  });

  it('creates key points as a durable inference map-reduce graph', async () => {
    await expect(service.keyPoints(scope, 7, 'en')).resolves.toEqual({
      executionId: executionIds['key-point'],
    });
    expect(executionService.create).toHaveBeenCalledWith(
      'key-point',
      expect.any(String),
      { resourceId: 7, targetLanguage: 'en' },
      {
        ownerPrincipal: scope.ownerPrincipal,
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
      service.ask(scope, 'Who designed it?', 3, 'request-1'),
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
      expect.objectContaining({
        ownerPrincipal: scope.ownerPrincipal,
        inputArtifacts: [expect.any(Object)],
      }),
    );
  });

  it('freezes scoped vector candidates for semantic search', async () => {
    await expect(
      service.semanticSearch(scope, 'engine', 3, 'request-2', 4),
    ).resolves.toEqual({ executionId: executionIds.search });
    expect(vectorStore.workspaceCandidates).toHaveBeenCalledWith(3);
    expect(executionService.create).toHaveBeenCalledWith(
      'search',
      expect.any(String),
      { query: 'engine', projectId: 3, requestId: 'request-2', limit: 4 },
      expect.objectContaining({
        ownerPrincipal: scope.ownerPrincipal,
        inputArtifacts: [expect.any(Object)],
      }),
    );
  });

  it('creates keywords as a durable map-reduce step graph', async () => {
    await expect(service.keywords(scope, 7, 'en')).resolves.toEqual({
      executionId: executionIds.keywords,
    });
    expect(executionService.create).toHaveBeenCalledWith(
      'keywords',
      expect.any(String),
      { resourceId: 7, targetLanguage: 'en' },
      {
        ownerPrincipal: scope.ownerPrincipal,
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
    await expect(service.extractEntities(scope, 7)).resolves.toEqual({
      executionId: executionIds['entity-extraction'],
    });
    expect(executionService.create).toHaveBeenCalledWith(
      'entity-extraction',
      expect.any(String),
      {
        resourceId: 7,
        sourceContentHash: contentHash('<p>Hola mundo</p>'),
        sourceLanguage: 'es',
      },
      {
        ownerPrincipal: scope.ownerPrincipal,
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

  it('creates translate as a durable map-reduce step graph', async () => {
    await expect(service.translate(scope, 7, 'en')).resolves.toEqual({
      executionId: executionIds.translate,
    });
    expect(executionService.create).toHaveBeenCalledWith(
      'translate',
      expect.any(String),
      expect.objectContaining({
        sourceLanguage: 'es',
        targetLanguage: 'en',
        sourceContentHash: contentHash('<p>Hola mundo</p>'),
      }),
      {
        ownerPrincipal: scope.ownerPrincipal,
        steps: [
          expect.objectContaining({
            stepKind: 'inference',
            requiredCapabilities: ['translate-map'],
          }),
          expect.objectContaining({
            stepKind: 'code',
            requiredCapabilities: ['translate-reduce'],
          }),
        ],
      },
    );
  });

  it('creates summarize as section summaries plus one global composition', async () => {
    await expect(
      service.summarize(scope, {
        targetLanguage: 'en',
        text: Array.from({ length: 90 }, () => 'palabra').join(' '),
        sourceLanguage: 'es',
        type: 'workspace-selection',
        targetDocId: 42,
      }),
    ).resolves.toEqual({ executionId: executionIds.summarize });

    expect(executionService.create).toHaveBeenCalledWith(
      'summarize',
      expect.any(String),
      expect.objectContaining({
        targetLanguage: 'en',
        sourceLanguage: 'es',
        targetDocId: 42,
      }),
      {
        ownerPrincipal: scope.ownerPrincipal,
        steps: [
          expect.objectContaining({
            stepKind: 'inference',
            requiredCapabilities: ['summarize-map'],
          }),
          expect.objectContaining({
            stepKind: 'inference',
            requiredCapabilities: ['summarize-compose'],
            work: expect.objectContaining({
              payload: expect.objectContaining({ maxWords: 80 }),
            }),
          }),
        ],
      },
    );
  });

  it('requests capture through the common execution options', async () => {
    await service.summarize(
      scope,
      {
        targetLanguage: 'en',
        text: 'Hola',
        sourceLanguage: 'es',
        type: 'workspace-selection',
      },
      true,
    );
    const [, , payload, options] = executionService.create.mock.calls[0];
    expect(payload).not.toHaveProperty('captureInference');
    expect(options).toEqual(
      expect.objectContaining({
        captureInference: true,
        ownerPrincipal: scope.ownerPrincipal,
      }),
    );
    for (const step of options.steps)
      expect(step.work).not.toHaveProperty('inferenceCapture');
  });

  it.each([
    [false, 79, false],
    [false, 80, true],
    [false, 81, true],
    [true, 39, false],
    [true, 40, true],
    [true, 41, true],
  ])(
    'applies the cutoff for selection=%s and %s input words',
    (selection, words, generated) => {
      const content =
        '  ' + Array.from({ length: words }, () => 'Café').join('  ') + '.\n';
      const steps = buildSummarizeWorkflowSteps(content, 'en', 'es', {
        selection,
      });
      if (generated) {
        expect(steps.map((step) => step.work.taskType)).toEqual([
          'summarize-map',
          'summarize-compose',
        ]);
        expect(steps[1].work.payload).toEqual(
          expect.objectContaining({ maxWords: words - 1 }),
        );
      } else {
        expect(steps).toEqual([
          {
            stepKind: 'code',
            work: {
              taskType: 'summarize-finalize',
              payload: { originalText: content },
            },
            requiredCapabilities: ['summarize-finalize'],
          },
        ]);
      }
    },
  );

  it('uses the route defaults and keeps a generated summary shorter than its input', () => {
    const words = Array.from({ length: 200 }, () => 'word');
    const resource = buildSummarizeWorkflowSteps(words.join(' '), 'en');
    const selection = buildSummarizeWorkflowSteps(words.join(' '), 'en', 'en', {
      selection: true,
    });
    const atThreshold = buildSummarizeWorkflowSteps(
      words.slice(0, 80).join(' '),
      'en',
    );
    expect(resource[1].work.payload).toEqual(
      expect.objectContaining({ maxWords: 150 }),
    );
    expect(selection[1].work.payload).toEqual(
      expect.objectContaining({ maxWords: 80 }),
    );
    expect(atThreshold[1].work.payload).toEqual(
      expect.objectContaining({ maxWords: 79 }),
    );
  });

  it.each([
    [2_800, 150],
    [2_801, 400],
  ])('uses the fixed resource limit at %s input words', (count, maxWords) => {
    const content = Array.from({ length: count }, () => 'word').join(' ');
    const resource = buildSummarizeWorkflowSteps(content, 'en');
    const selection = buildSummarizeWorkflowSteps(content, 'en', 'en', {
      selection: true,
    });
    expect(resource.at(-1)?.work.payload).toEqual(
      expect.objectContaining({ maxWords }),
    );
    expect(selection.at(-1)?.work.payload).toEqual(
      expect.objectContaining({ maxWords: 80 }),
    );
  });

  it('fans long summaries out without splitting paragraphs', () => {
    const firstParagraph = Array.from(
      { length: 600 },
      (_, index) => `first-${index}`,
    ).join(' ');
    const secondParagraph = Array.from(
      { length: 451 },
      (_, index) => `second-${index}`,
    ).join(' ');
    const content = `${firstParagraph}\n\n${secondParagraph}`;

    const steps = buildSummarizeWorkflowSteps(content, 'en', 'es');

    expect(steps).toHaveLength(2);
    expect(steps[0].work.payload).toEqual(expect.objectContaining({ content }));
    const composition = steps[1];
    expect(composition).toEqual(
      expect.objectContaining({
        stepKind: 'inference',
        dependsOnStepIds: [steps[0].stepId],
        requiredCapabilities: ['summarize-compose'],
        work: expect.objectContaining({
          payload: expect.objectContaining({ targetLanguage: 'en' }),
          coordination: expect.objectContaining({ resultKey: 'summary' }),
        }),
      }),
    );
  });

  it('sends every section summary to one global composition', () => {
    const content = Array.from({ length: 21 }, (_, paragraphIndex) =>
      Array.from(
        { length: 700 },
        (_, wordIndex) => `paragraph-${paragraphIndex}-${wordIndex}`,
      ).join(' '),
    ).join('\n\n');

    const steps = buildSummarizeWorkflowSteps(content, 'en', 'es');
    const maps = steps.filter((step) => step.work.taskType === 'summarize-map');
    const compositions = steps.filter(
      (step) => step.work.taskType === 'summarize-compose',
    );
    expect(maps).toHaveLength(6);
    expect(compositions).toHaveLength(1);
    expect(compositions[0]).toEqual(
      expect.objectContaining({
        stepKind: 'inference',
        dependsOnStepIds: maps.map((step) => step.stepId),
        requiredCapabilities: ['summarize-compose'],
        work: expect.objectContaining({
          coordination: expect.objectContaining({
            mapStepIds: maps.map((step) => step.stepId),
            resultKey: 'summary',
          }),
        }),
      }),
    );
    expect(new Set(steps.map((step) => step.stepId)).size).toBe(steps.length);
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

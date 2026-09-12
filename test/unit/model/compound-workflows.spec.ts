import { buildDateExtractionWorkflowSteps } from '../../../src/model/date-extraction-workflow';
import { buildEntityExtractionWorkflowSteps } from '../../../src/model/entity-extraction-workflow';
import { buildKeyPointWorkflowSteps } from '../../../src/model/key-point-workflow';
import { buildKeywordsWorkflowSteps } from '../../../src/model/keywords-workflow';
// eslint-disable-next-line max-len
import { buildRelationshipExtractionWorkflowSteps } from '../../../src/model/relationship-extraction-workflow';
import { buildSummarizeWorkflowSteps } from '../../../src/model/summarize-workflow';

describe('compound model workflows', () => {
  it.each([
    [
      'entities',
      (text: string) => buildEntityExtractionWorkflowSteps([{ text }]),
    ],
    [
      'keywords',
      (text: string) => buildKeywordsWorkflowSteps([{ text }], 'en'),
    ],
    [
      'key points',
      (text: string) => buildKeyPointWorkflowSteps([{ text }], 'en'),
    ],
    [
      'dates',
      (text: string) =>
        buildDateExtractionWorkflowSteps([{ text }], 'en', null),
    ],
    [
      'relationships',
      (text: string) =>
        buildRelationshipExtractionWorkflowSteps(
          [{ text }],
          [
            { id: 1, name: 'Ada', type: 'PERSON' },
            { id: 2, name: 'Engine', type: 'PRODUCT' },
          ],
        ),
    ],
  ])('uses bounded reduction levels for large %s input', (_, build) => {
    const text = Array.from(
      { length: 13_501 },
      (_, index) => `word-${index}`,
    ).join(' ');
    const reductions = build(text).filter((step) =>
      String(step.work.taskType).endsWith('-reduce'),
    );

    expect(reductions.length).toBeGreaterThan(1);
    expect(
      reductions.every(
        (step) =>
          (step.dependsOnStepIds?.length ?? 0) >= 1 &&
          (step.dependsOnStepIds?.length ?? 0) <= 8,
      ),
    ).toBe(true);
  });

  it('summarizes through smart maps and one global composition', () => {
    const paragraph = Array.from(
      { length: 120 },
      (_, index) => `word-${index}`,
    ).join(' ');
    const steps = buildSummarizeWorkflowSteps(
      Array.from({ length: 18 }, () => paragraph).join('\n\n'),
      'es',
      'es',
    );
    const maps = steps.filter((step) => step.work.taskType === 'summarize-map');
    const compositions = steps.filter(
      (step) => step.work.taskType === 'summarize-compose',
    );

    expect(maps).toHaveLength(1);
    expect(compositions).toHaveLength(1);
    expect(compositions[0]).toEqual(
      expect.objectContaining({
        stepKind: 'inference',
        dependsOnStepIds: maps.map((step) => step.stepId),
        requiredCapabilities: ['summarize-compose'],
        work: expect.objectContaining({
          taskType: 'summarize-compose',
          payload: expect.objectContaining({ targetLanguage: 'es' }),
          coordination: expect.objectContaining({
            mapStepIds: maps.map((step) => step.stepId),
            resultKey: 'ideas',
          }),
        }),
      }),
    );
    expect(steps).toHaveLength(2);
  });

  it('carries exact keyword statistics across intermediate levels', () => {
    const text = Array.from(
      { length: 13_501 },
      (_, index) => `word-${index}`,
    ).join(' ');
    const reductions = buildKeywordsWorkflowSteps([{ text }], 'en').filter(
      (step) => step.work.taskType === 'keywords-reduce',
    );
    const intermediate = reductions.find(
      (step) => (step.work.payload as { final: boolean }).final === false,
    )!;
    const final = reductions.at(-1)!;

    expect(intermediate.work).toEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          final: false,
          inputKind: 'candidates',
        }),
        coordination: expect.objectContaining({ resultKey: 'keywords' }),
      }),
    );
    expect(final.work).toEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          final: true,
          inputKind: 'statistics',
        }),
        coordination: expect.objectContaining({
          resultKey: 'keyword_statistics',
        }),
      }),
    );
  });
});

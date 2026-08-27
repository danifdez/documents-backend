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
      'summarize',
      (text: string) => buildSummarizeWorkflowSteps(text, 'es', 'en'),
    ],
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
});

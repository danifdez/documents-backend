import { buildTranslateWorkflowSteps } from '../../../src/model/translate-workflow';

describe('translate workflow', () => {
  it('splits bounded map assignments and preserves content references', () => {
    const texts = Array.from({ length: 33 }, (_, index) => ({
      text: `source-${index}`,
      path: `p:nth-child(${index + 1})`,
    }));
    const steps = buildTranslateWorkflowSteps({
      texts,
      sourceLanguage: 'en',
      targetLanguages: ['es'],
      responseMode: 'items',
    });
    const maps = steps.filter((step) => step.work.taskType === 'translate-map');
    const final = steps.at(-1)!;

    expect(maps).toHaveLength(2);
    expect(
      maps.every(
        (step) =>
          ((step.work.payload as { units: unknown[] }).units.length ?? 0) <= 32,
      ),
    ).toBe(true);
    expect(final.work.taskType).toBe('translate-reduce');
    expect(final.dependsOnStepIds).toEqual(maps.map((step) => step.stepId));
    expect(final.work.payload).toEqual(
      expect.objectContaining({
        final: true,
        responseMode: 'items',
        itemCount: 33,
        targetLanguages: ['es'],
      }),
    );
  });

  it('builds a bounded tree for multiple target languages', () => {
    const targetLanguages = Array.from(
      { length: 65 },
      (_, index) => `language-${index}`,
    );
    const steps = buildTranslateWorkflowSteps({
      texts: ['Entity'],
      sourceLanguage: 'en',
      targetLanguages,
      responseMode: 'targets',
    });
    const reductions = steps.filter(
      (step) => step.work.taskType === 'translate-reduce',
    );

    expect(reductions.length).toBeGreaterThan(1);
    expect(
      reductions.every((step) => (step.dependsOnStepIds?.length ?? 0) <= 8),
    ).toBe(true);
    expect(steps.at(-1)!.work.payload).toEqual(
      expect.objectContaining({ final: true, targetLanguages }),
    );
  });
});

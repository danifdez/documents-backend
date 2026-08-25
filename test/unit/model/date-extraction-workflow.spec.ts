import { buildDateExtractionWorkflowSteps } from '../../../src/model/date-extraction-workflow';

describe('date extraction workflow', () => {
  it('fans chunks out into bounded inference maps and one code reduce', () => {
    const content = Array.from(
      { length: 1_501 },
      (_, index) => `word-${index}`,
    ).join(' ');

    const steps = buildDateExtractionWorkflowSteps(
      [{ text: content }],
      'es',
      '2026-08-25',
    );

    expect(steps).toHaveLength(3);
    expect(steps.slice(0, 2)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepKind: 'inference',
          requiredCapabilities: ['date-extraction-map'],
          work: expect.objectContaining({
            taskType: 'date-extraction-map',
            payload: expect.objectContaining({
              language: 'es',
              anchorDate: '2026-08-25',
            }),
          }),
        }),
      ]),
    );
    expect(steps[2]).toEqual(
      expect.objectContaining({
        stepKind: 'code',
        dependsOnStepIds: [steps[0].stepId, steps[1].stepId],
        requiredCapabilities: ['date-extraction-reduce'],
        operationKind: 'artifact_processing',
        recoveryClass: 'read_only_replayable',
        work: expect.objectContaining({
          coordination: {
            kind: 'map-reduce-reduce/1',
            mapStepIds: [steps[0].stepId, steps[1].stepId],
            resultKey: 'dates',
          },
        }),
      }),
    );
  });

  it('uses a deterministic empty reduce when the document has no text', () => {
    const steps = buildDateExtractionWorkflowSteps([], null, null);

    expect(steps).toEqual([
      expect.objectContaining({
        stepKind: 'code',
        dependsOnStepIds: [],
        requiredCapabilities: ['date-extraction-reduce'],
        work: {
          taskType: 'date-extraction-reduce',
          payload: { partials: [] },
        },
      }),
    ]);
  });
});

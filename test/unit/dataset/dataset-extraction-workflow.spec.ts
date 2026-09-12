// eslint-disable-next-line max-len
import { buildDatasetExtractionWorkflowSteps } from '../../../src/dataset/dataset-extraction-workflow';

describe('dataset extraction workflow', () => {
  const input = {
    datasetId: 3,
    recordId: 5,
    resourceId: 7,
    projectId: 11,
    schema: [
      {
        key: 'name',
        name: 'Name',
        description: 'Person name',
        type: 'text' as const,
        required: false,
      },
    ],
    columnsToExtract: ['name'],
    documentText: '',
    sourceTitle: 'Source',
    isAudio: false,
    model: 'test-model',
  };

  it('extracts every chunk and reduces candidates deterministically', () => {
    const steps = buildDatasetExtractionWorkflowSteps({
      ...input,
      documentText: Array.from(
        { length: 1_501 },
        (_, index) => `word-${index}`,
      ).join(' '),
    });
    const maps = steps.filter(
      (step) => step.work.taskType === 'dataset.extract-row-map',
    );
    const final = steps.at(-1)!;

    expect(maps).toHaveLength(2);
    expect(
      maps.every(
        (step) =>
          (step.work.payload as { documentText: string }).documentText.split(
            /\s+/,
          ).length <= 1_500,
      ),
    ).toBe(true);
    expect(
      maps.map(
        (step) => (step.work.payload as { chunkIndex: number }).chunkIndex,
      ),
    ).toEqual([0, 1]);
    expect(final).toEqual(
      expect.objectContaining({
        stepKind: 'code',
        dependsOnStepIds: maps.map((step) => step.stepId),
        finalizeOnFailure: true,
        requiredCapabilities: ['dataset.extract-row-reduce'],
        work: expect.objectContaining({
          payload: { final: true },
          coordination: {
            kind: 'map-reduce-reduce/1',
            mapStepIds: maps.map((step) => step.stepId),
            resultKey: 'candidates',
          },
        }),
      }),
    );
  });

  it('keeps empty content as a failing map assignment for reconciliation', () => {
    const steps = buildDatasetExtractionWorkflowSteps(input);

    expect(steps[0]).toEqual(
      expect.objectContaining({
        finalizeOnFailure: true,
        work: expect.objectContaining({
          taskType: 'dataset.extract-row-map',
          payload: expect.objectContaining({ documentText: '' }),
        }),
      }),
    );
  });
});

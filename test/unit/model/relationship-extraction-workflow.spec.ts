// eslint-disable-next-line max-len
import { buildRelationshipExtractionWorkflowSteps } from '../../../src/model/relationship-extraction-workflow';

describe('relationship extraction workflow', () => {
  const entities = [
    { id: 1, name: 'Ada Lovelace', type: 'PERSON' },
    { id: 2, name: 'Analytical Engine', type: 'PRODUCT' },
  ];

  it('fans chunks out into inference maps and one code reduce', () => {
    const content = Array.from(
      { length: 1_501 },
      (_, index) => `word-${index}`,
    ).join(' ');

    const steps = buildRelationshipExtractionWorkflowSteps(
      [{ text: content }],
      entities,
    );

    expect(steps).toHaveLength(3);
    expect(steps.slice(0, 2)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepKind: 'inference',
          requiredCapabilities: ['relationship-extraction-map'],
          work: expect.objectContaining({
            taskType: 'relationship-extraction-map',
            payload: expect.objectContaining({ entities }),
          }),
        }),
      ]),
    );
    expect(steps[2]).toEqual(
      expect.objectContaining({
        stepKind: 'code',
        dependsOnStepIds: [steps[0].stepId, steps[1].stepId],
        requiredCapabilities: ['relationship-extraction-reduce'],
        operationKind: 'artifact_processing',
        recoveryClass: 'read_only_replayable',
        work: expect.objectContaining({
          coordination: {
            kind: 'map-reduce-reduce/1',
            mapStepIds: [steps[0].stepId, steps[1].stepId],
            resultKey: 'relationships',
          },
        }),
      }),
    );
  });

  it('rejects an unbounded root without enough domain input', () => {
    expect(() =>
      buildRelationshipExtractionWorkflowSteps([], entities),
    ).toThrow('Relationship extraction content is empty');
    expect(() =>
      buildRelationshipExtractionWorkflowSteps(
        [{ text: 'Ada wrote notes.' }],
        [entities[0]],
      ),
    ).toThrow('Relationship extraction requires at least two entities');
  });
});

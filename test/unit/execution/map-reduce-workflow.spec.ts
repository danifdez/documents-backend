import {
  REDUCTION_TREE_FAN_IN,
  buildMapComposeWorkflow,
  buildMapReduceWorkflow,
  buildReductionTree,
} from '../../../src/execution/map-reduce-workflow';
import { ExecutionStepKind } from '../../../src/execution/execution-step-kind.enum';
import { executionTaskWork } from '../../../src/execution/execution-task-payload.types';

describe('map-reduce workflow', () => {
  it('bounds every reduction node and leaves one terminal step', () => {
    const leaves = Array.from({ length: 65 }, (_, index) => ({
      stepId: `leaf-${index}`,
      stepKind: ExecutionStepKind.INFERENCE,
      work: executionTaskWork('summarize-map', {
        content: `chunk-${index}`,
        chunkIndex: index,
        targetLanguage: 'en',
      }),
    }));

    const steps = buildReductionTree(
      leaves,
      ({ dependencyStepIds, level }) => ({
        stepKind: ExecutionStepKind.CODE,
        dependsOnStepIds: dependencyStepIds,
        work: executionTaskWork('summarize-reduce', {
          targetLanguage: 'en',
          reductionLevel: level,
        }),
      }),
    );
    const reductions = steps.slice(leaves.length);

    expect(reductions.length).toBeGreaterThan(1);
    expect(
      reductions.every(
        (step) =>
          (step.dependsOnStepIds?.length ?? 0) >= 1 &&
          (step.dependsOnStepIds?.length ?? 0) <= REDUCTION_TREE_FAN_IN,
      ),
    ).toBe(true);
    expect(steps.at(-1)?.dependsOnStepIds).toHaveLength(2);
  });

  it('builds ordered maps and injects their outputs into every reduction', () => {
    const steps = buildMapReduceWorkflow({
      items: ['first', 'second'],
      emptyInputError: 'Nothing to process',
      map: (content, chunkIndex) => ({
        work: executionTaskWork('summarize-map', {
          content,
          chunkIndex,
          targetLanguage: 'en',
        }),
        requiredCapabilities: ['summarize-map'],
      }),
      reduce: ({ level }) => ({
        stepKind: ExecutionStepKind.CODE,
        work: executionTaskWork('summarize-reduce', {
          targetLanguage: 'en',
          reductionLevel: level,
        }),
        requiredCapabilities: ['summarize-reduce'],
        resultKey: 'ideas',
      }),
    });

    const mapStepIds = steps.slice(0, 2).map((step) => step.stepId);
    expect(steps).toHaveLength(3);
    expect(steps[2]).toEqual(
      expect.objectContaining({
        stepKind: ExecutionStepKind.CODE,
        dependsOnStepIds: mapStepIds,
        work: expect.objectContaining({
          coordination: {
            kind: 'map-reduce-reduce/1',
            mapStepIds,
            resultKey: 'ideas',
          },
        }),
      }),
    );
  });

  it('gives all ordered map outputs to one composition', () => {
    const steps = buildMapComposeWorkflow({
      items: ['first', 'second'],
      emptyInputError: 'Nothing to process',
      resultKey: 'ideas',
      map: (content, chunkIndex) => ({
        work: executionTaskWork('summarize-map', {
          content,
          chunkIndex,
          targetLanguage: 'en',
        }),
        requiredCapabilities: ['summarize-map'],
      }),
      compose: () => ({
        work: executionTaskWork('summarize-compose', {
          targetLanguage: 'en',
        }),
        requiredCapabilities: ['summarize-compose'],
      }),
    });

    const mapStepIds = steps.slice(0, 2).map((step) => step.stepId);
    expect(steps).toHaveLength(3);
    expect(steps[2]).toEqual(
      expect.objectContaining({
        dependsOnStepIds: mapStepIds,
        work: expect.objectContaining({
          coordination: {
            kind: 'map-reduce-reduce/1',
            mapStepIds,
            resultKey: 'ideas',
          },
        }),
      }),
    );
  });

  it('rejects a workflow without map inputs', () => {
    expect(() =>
      buildMapComposeWorkflow({
        items: [],
        emptyInputError: 'Nothing to process',
        resultKey: 'ideas',
        map: () => {
          throw new Error('unreachable');
        },
        compose: () => {
          throw new Error('unreachable');
        },
      }),
    ).toThrow('Nothing to process');
  });
});

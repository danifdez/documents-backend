import { ExecutionStepKind } from '../../../src/execution/execution-step-kind.enum';
import { executionTaskWork } from '../../../src/execution/execution-task-payload.types';
import {
  REDUCTION_TREE_FAN_IN,
  buildReductionTree,
} from '../../../src/model/reduction-tree';

describe('reduction tree', () => {
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

    const steps = buildReductionTree(leaves, ({ dependencyStepIds }) => ({
      stepKind: ExecutionStepKind.CODE,
      dependsOnStepIds: dependencyStepIds,
      work: executionTaskWork('summarize-reduce', {
        targetLanguage: 'en',
      }),
    }));
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
});

import { randomUUID } from 'crypto';
import { CreateExecutionStepInput } from '../execution/execution-control-plane.types';
import { executionTaskWork } from '../execution/execution-task-payload.types';
import { ExecutionStepKind } from '../execution/execution-step-kind.enum';
import { chunkTextParts } from './text-chunks';
import { buildReductionTree } from './reduction-tree';

const MAP_WORD_BUDGET = 1_500;

export function buildKeyPointWorkflowSteps(
  textParts: Array<{ text: string }>,
  targetLanguage: string,
): Array<Omit<CreateExecutionStepInput, 'executionId'>> {
  const chunks = chunkTextParts(textParts, MAP_WORD_BUDGET);
  if (!chunks.length) throw new Error('Key-point content is empty');

  const mapSteps = chunks.map((content, chunkIndex) => ({
    stepId: randomUUID(),
    stepKind: ExecutionStepKind.INFERENCE,
    work: {
      ...executionTaskWork('key-point-map', {
        content,
        chunkIndex,
        targetLanguage,
      }),
    },
    requiredCapabilities: ['key-point-map'],
  }));
  return buildReductionTree(mapSteps, ({ dependencyStepIds }) => ({
    stepKind: ExecutionStepKind.INFERENCE,
    dependsOnStepIds: dependencyStepIds,
    work: {
      ...executionTaskWork('key-point-reduce', { targetLanguage }),
      coordination: {
        kind: 'map-reduce-reduce/1',
        mapStepIds: dependencyStepIds,
        resultKey: 'key_points',
      },
    },
    requiredCapabilities: ['key-point-reduce'],
  }));
}

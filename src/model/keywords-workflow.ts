import { randomUUID } from 'crypto';
import { CreateExecutionStepInput } from '../execution/execution-control-plane.types';
import { ExecutionOperationKind } from '../execution/execution-operation-kind.enum';
// eslint-disable-next-line max-len
import { ExecutionOperationRecoveryClass } from '../execution/execution-operation-recovery-class.enum';
import { ExecutionStepKind } from '../execution/execution-step-kind.enum';
import { chunkTextParts } from './text-chunks';
import { buildReductionTree } from './reduction-tree';
import { REDUCTION_TREE_FAN_IN } from './reduction-tree';

const MAP_WORD_BUDGET = 1_500;

export function buildKeywordsWorkflowSteps(
  textParts: Array<{ text: string }>,
  targetLanguage: string,
): Array<Omit<CreateExecutionStepInput, 'executionId'>> {
  const chunks = chunkTextParts(textParts, MAP_WORD_BUDGET);
  if (!chunks.length) throw new Error('Keywords content is empty');

  const mapSteps = chunks.map((content, chunkIndex) => ({
    stepId: randomUUID(),
    stepKind: ExecutionStepKind.INFERENCE,
    work: {
      taskType: 'keywords-map',
      payload: { content, chunkIndex, targetLanguage },
    },
    requiredCapabilities: ['keywords-map'],
  }));
  return buildReductionTree(
    mapSteps,
    ({ dependencyStepIds, level, groupIndex, final }) => ({
      stepKind: ExecutionStepKind.CODE,
      dependsOnStepIds: dependencyStepIds,
      work: {
        taskType: 'keywords-reduce',
        payload: {
          final,
          inputKind: level === 1 ? 'candidates' : 'statistics',
          ...(level === 1
            ? { leafStartIndex: groupIndex * REDUCTION_TREE_FAN_IN }
            : {}),
        },
        coordination: {
          kind: 'map-reduce-reduce/1',
          mapStepIds: dependencyStepIds,
          resultKey: level === 1 ? 'keywords' : 'keyword_statistics',
        },
      },
      requiredCapabilities: ['keywords-reduce'],
      operationKind: ExecutionOperationKind.ARTIFACT_PROCESSING,
      recoveryClass: ExecutionOperationRecoveryClass.READ_ONLY_REPLAYABLE,
    }),
  );
}

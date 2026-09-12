import { CreateExecutionStepInput } from '../execution/execution-control-plane.types';
import {
  REDUCTION_TREE_FAN_IN,
  buildMapReduceWorkflow,
} from '../execution/map-reduce-workflow';
import { executionTaskWork } from '../execution/execution-task-payload.types';
import { ExecutionOperationKind } from '../execution/execution-operation-kind.enum';
// eslint-disable-next-line max-len
import { ExecutionOperationRecoveryClass } from '../execution/execution-operation-recovery-class.enum';
import { ExecutionStepKind } from '../execution/execution-step-kind.enum';
import { chunkTextParts } from './text-chunks';

const MAP_WORD_BUDGET = 1_500;

export function buildKeywordsWorkflowSteps(
  textParts: Array<{ text: string }>,
  targetLanguage: string,
): Array<Omit<CreateExecutionStepInput, 'executionId'>> {
  const chunks = chunkTextParts(textParts, MAP_WORD_BUDGET);
  return buildMapReduceWorkflow({
    items: chunks,
    emptyInputError: 'Keywords content is empty',
    map: (content, chunkIndex) => ({
      work: executionTaskWork('keywords-map', {
        content,
        chunkIndex,
        targetLanguage,
      }),
      requiredCapabilities: ['keywords-map'],
    }),
    reduce: ({ level, groupIndex, final }) => ({
      stepKind: ExecutionStepKind.CODE,
      work: executionTaskWork('keywords-reduce', {
        final,
        inputKind: level === 1 ? 'candidates' : 'statistics',
        ...(level === 1
          ? { leafStartIndex: groupIndex * REDUCTION_TREE_FAN_IN }
          : {}),
      }),
      requiredCapabilities: ['keywords-reduce'],
      operationKind: ExecutionOperationKind.ARTIFACT_PROCESSING,
      recoveryClass: ExecutionOperationRecoveryClass.READ_ONLY_REPLAYABLE,
      resultKey: level === 1 ? 'keywords' : 'keyword_statistics',
    }),
  });
}

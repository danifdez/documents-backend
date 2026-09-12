import { CreateExecutionStepInput } from '../execution/execution-control-plane.types';
import { buildMapReduceWorkflow } from '../execution/map-reduce-workflow';
import { executionTaskWork } from '../execution/execution-task-payload.types';
import { ExecutionOperationKind } from '../execution/execution-operation-kind.enum';
// eslint-disable-next-line max-len
import { ExecutionOperationRecoveryClass } from '../execution/execution-operation-recovery-class.enum';
import { ExecutionStepKind } from '../execution/execution-step-kind.enum';
import { chunkTextParts } from './text-chunks';

const MAP_WORD_BUDGET = 1_500;

export function buildDateExtractionWorkflowSteps(
  textParts: Array<{ text: string }>,
  language: string | null,
  anchorDate: string | null,
): Array<Omit<CreateExecutionStepInput, 'executionId'>> {
  let charOffset = 0;
  const chunks = chunkTextParts(textParts, MAP_WORD_BUDGET);
  if (!chunks.length) {
    return [
      {
        stepKind: ExecutionStepKind.CODE,
        dependsOnStepIds: [],
        work: {
          ...executionTaskWork('date-extraction-reduce', { partials: [] }),
        },
        requiredCapabilities: ['date-extraction-reduce'],
        operationKind: ExecutionOperationKind.ARTIFACT_PROCESSING,
        recoveryClass: ExecutionOperationRecoveryClass.READ_ONLY_REPLAYABLE,
      },
    ];
  }

  return buildMapReduceWorkflow({
    items: chunks,
    emptyInputError: 'Date extraction content is empty',
    map: (content, chunkIndex) => {
      const stage = {
        work: executionTaskWork('date-extraction-map', {
          content,
          chunkIndex,
          charOffset,
          language,
          anchorDate,
        }),
        requiredCapabilities: ['date-extraction-map'],
      };
      charOffset += content.length + 2;
      return stage;
    },
    reduce: () => ({
      stepKind: ExecutionStepKind.CODE,
      work: executionTaskWork('date-extraction-reduce', {}),
      requiredCapabilities: ['date-extraction-reduce'],
      operationKind: ExecutionOperationKind.ARTIFACT_PROCESSING,
      recoveryClass: ExecutionOperationRecoveryClass.READ_ONLY_REPLAYABLE,
      resultKey: 'dates',
    }),
  });
}

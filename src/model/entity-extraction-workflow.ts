import { CreateExecutionStepInput } from '../execution/execution-control-plane.types';
import { buildMapReduceWorkflow } from '../execution/map-reduce-workflow';
import { executionTaskWork } from '../execution/execution-task-payload.types';
import { ExecutionOperationKind } from '../execution/execution-operation-kind.enum';
// eslint-disable-next-line max-len
import { ExecutionOperationRecoveryClass } from '../execution/execution-operation-recovery-class.enum';
import { ExecutionStepKind } from '../execution/execution-step-kind.enum';
import { chunkTextParts } from './text-chunks';

const MAP_WORD_BUDGET = 1_500;

export function buildEntityExtractionWorkflowSteps(
  textParts: Array<{ text: string }>,
): Array<Omit<CreateExecutionStepInput, 'executionId'>> {
  const chunks = chunkTextParts(textParts, MAP_WORD_BUDGET);
  return buildMapReduceWorkflow({
    items: chunks,
    emptyInputError: 'Entity extraction content is empty',
    map: (content, chunkIndex) => ({
      work: executionTaskWork('entity-extraction-map', {
        content,
        chunkIndex,
      }),
      requiredCapabilities: ['entity-extraction-map'],
    }),
    reduce: () => ({
      stepKind: ExecutionStepKind.CODE,
      work: executionTaskWork('entity-extraction-reduce', {}),
      requiredCapabilities: ['entity-extraction-reduce'],
      operationKind: ExecutionOperationKind.ARTIFACT_PROCESSING,
      recoveryClass: ExecutionOperationRecoveryClass.READ_ONLY_REPLAYABLE,
      resultKey: 'entities',
    }),
  });
}

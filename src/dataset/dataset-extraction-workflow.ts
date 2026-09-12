import { CreateExecutionStepInput } from '../execution/execution-control-plane.types';
import { buildMapReduceWorkflow } from '../execution/map-reduce-workflow';
import {
  DatasetExtractRowPayload,
  executionTaskWork,
} from '../execution/execution-task-payload.types';
import { ExecutionOperationKind } from '../execution/execution-operation-kind.enum';
// eslint-disable-next-line max-len
import { ExecutionOperationRecoveryClass } from '../execution/execution-operation-recovery-class.enum';
import { ExecutionStepKind } from '../execution/execution-step-kind.enum';
import { chunkTextParts } from '../model/text-chunks';

const MAP_WORD_BUDGET = 1_500;

export function buildDatasetExtractionWorkflowSteps(
  input: DatasetExtractRowPayload,
): Array<Omit<CreateExecutionStepInput, 'executionId'>> {
  const chunks = chunkTextParts(
    [{ text: input.documentText }],
    MAP_WORD_BUDGET,
  );

  return buildMapReduceWorkflow({
    items: chunks.length ? chunks : [input.documentText],
    emptyInputError: 'Dataset extraction content is empty',
    map: (documentText, chunkIndex) => ({
      work: executionTaskWork('dataset.extract-row-map', {
        ...input,
        documentText,
        chunkIndex,
      }),
      requiredCapabilities: ['dataset.extract-row-map'],
      finalizeOnFailure: true,
    }),
    reduce: ({ final }) => ({
      stepKind: ExecutionStepKind.CODE,
      work: executionTaskWork('dataset.extract-row-reduce', { final }),
      requiredCapabilities: ['dataset.extract-row-reduce'],
      operationKind: ExecutionOperationKind.ARTIFACT_PROCESSING,
      recoveryClass: ExecutionOperationRecoveryClass.READ_ONLY_REPLAYABLE,
      finalizeOnFailure: true,
      resultKey: 'candidates',
    }),
  });
}

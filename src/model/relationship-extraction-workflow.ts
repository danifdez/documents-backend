import { CreateExecutionStepInput } from '../execution/execution-control-plane.types';
import { buildMapReduceWorkflow } from '../execution/map-reduce-workflow';
import { executionTaskWork } from '../execution/execution-task-payload.types';
import { ExecutionOperationKind } from '../execution/execution-operation-kind.enum';
// eslint-disable-next-line max-len
import { ExecutionOperationRecoveryClass } from '../execution/execution-operation-recovery-class.enum';
import { ExecutionStepKind } from '../execution/execution-step-kind.enum';
import { chunkTextParts } from './text-chunks';

const MAP_WORD_BUDGET = 1_500;

export interface RelationshipWorkflowEntity {
  id: number;
  name: string;
  type: string;
}

export function buildRelationshipExtractionWorkflowSteps(
  textParts: Array<{ text: string }>,
  entities: RelationshipWorkflowEntity[],
): Array<Omit<CreateExecutionStepInput, 'executionId'>> {
  if (entities.length < 2) {
    throw new Error('Relationship extraction requires at least two entities');
  }
  const chunks = chunkTextParts(textParts, MAP_WORD_BUDGET);
  return buildMapReduceWorkflow({
    items: chunks,
    emptyInputError: 'Relationship extraction content is empty',
    map: (content, chunkIndex) => ({
      work: executionTaskWork('relationship-extraction-map', {
        content,
        chunkIndex,
        entities,
      }),
      requiredCapabilities: ['relationship-extraction-map'],
    }),
    reduce: () => ({
      stepKind: ExecutionStepKind.CODE,
      work: executionTaskWork('relationship-extraction-reduce', {}),
      requiredCapabilities: ['relationship-extraction-reduce'],
      operationKind: ExecutionOperationKind.ARTIFACT_PROCESSING,
      recoveryClass: ExecutionOperationRecoveryClass.READ_ONLY_REPLAYABLE,
      resultKey: 'relationships',
    }),
  });
}

import { randomUUID } from 'crypto';
import { CreateExecutionStepInput } from '../execution/execution-control-plane.types';
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
  if (!chunks.length) {
    throw new Error('Relationship extraction content is empty');
  }
  const mapSteps = chunks.map((content, chunkIndex) => ({
    stepId: randomUUID(),
    stepKind: ExecutionStepKind.INFERENCE,
    work: {
      taskType: 'relationship-extraction-map',
      payload: { content, chunkIndex, entities },
    },
    requiredCapabilities: ['relationship-extraction-map'],
  }));
  const mapStepIds = mapSteps.map((step) => step.stepId);

  return [
    ...mapSteps,
    {
      stepKind: ExecutionStepKind.CODE,
      dependsOnStepIds: mapStepIds,
      work: {
        taskType: 'relationship-extraction-reduce',
        payload: {},
        coordination: {
          kind: 'map-reduce-reduce/1',
          mapStepIds,
          resultKey: 'relationships',
        },
      },
      requiredCapabilities: ['relationship-extraction-reduce'],
      operationKind: ExecutionOperationKind.ARTIFACT_PROCESSING,
      recoveryClass: ExecutionOperationRecoveryClass.READ_ONLY_REPLAYABLE,
    },
  ];
}

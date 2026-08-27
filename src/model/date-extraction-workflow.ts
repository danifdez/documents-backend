import { randomUUID } from 'crypto';
import { CreateExecutionStepInput } from '../execution/execution-control-plane.types';
import { ExecutionOperationKind } from '../execution/execution-operation-kind.enum';
// eslint-disable-next-line max-len
import { ExecutionOperationRecoveryClass } from '../execution/execution-operation-recovery-class.enum';
import { ExecutionStepKind } from '../execution/execution-step-kind.enum';
import { chunkTextParts } from './text-chunks';
import { buildReductionTree } from './reduction-tree';

const MAP_WORD_BUDGET = 1_500;

export function buildDateExtractionWorkflowSteps(
  textParts: Array<{ text: string }>,
  language: string | null,
  anchorDate: string | null,
): Array<Omit<CreateExecutionStepInput, 'executionId'>> {
  let charOffset = 0;
  const mapSteps = chunkTextParts(textParts, MAP_WORD_BUDGET).map(
    (content, chunkIndex) => {
      const step = {
        stepId: randomUUID(),
        stepKind: ExecutionStepKind.INFERENCE,
        work: {
          taskType: 'date-extraction-map',
          payload: {
            content,
            chunkIndex,
            charOffset,
            language,
            anchorDate,
          },
        },
        requiredCapabilities: ['date-extraction-map'],
      };
      charOffset += content.length + 2;
      return step;
    },
  );
  if (!mapSteps.length) {
    return [
      {
        stepKind: ExecutionStepKind.CODE,
        dependsOnStepIds: [],
        work: {
          taskType: 'date-extraction-reduce',
          payload: { partials: [] },
        },
        requiredCapabilities: ['date-extraction-reduce'],
        operationKind: ExecutionOperationKind.ARTIFACT_PROCESSING,
        recoveryClass: ExecutionOperationRecoveryClass.READ_ONLY_REPLAYABLE,
      },
    ];
  }

  return buildReductionTree(mapSteps, ({ dependencyStepIds }) => ({
    stepKind: ExecutionStepKind.CODE,
    dependsOnStepIds: dependencyStepIds,
    work: {
      taskType: 'date-extraction-reduce',
      payload: {},
      coordination: {
        kind: 'map-reduce-reduce/1',
        mapStepIds: dependencyStepIds,
        resultKey: 'dates',
      },
    },
    requiredCapabilities: ['date-extraction-reduce'],
    operationKind: ExecutionOperationKind.ARTIFACT_PROCESSING,
    recoveryClass: ExecutionOperationRecoveryClass.READ_ONLY_REPLAYABLE,
  }));
}

import { randomUUID } from 'crypto';
import { CreateExecutionStepInput } from '../execution/execution-control-plane.types';
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
  const mapStepIds = mapSteps.map((step) => step.stepId);

  return [
    ...mapSteps,
    {
      stepKind: ExecutionStepKind.CODE,
      dependsOnStepIds: mapStepIds,
      work: {
        taskType: 'date-extraction-reduce',
        payload: mapStepIds.length ? {} : { partials: [] },
        ...(mapStepIds.length
          ? {
              coordination: {
                kind: 'map-reduce-reduce/1',
                mapStepIds,
                resultKey: 'dates',
              },
            }
          : {}),
      },
      requiredCapabilities: ['date-extraction-reduce'],
      operationKind: ExecutionOperationKind.ARTIFACT_PROCESSING,
      recoveryClass: ExecutionOperationRecoveryClass.READ_ONLY_REPLAYABLE,
    },
  ];
}

import { randomUUID } from 'crypto';
import { CreateExecutionStepInput } from '../execution/execution-control-plane.types';
import { ExecutionOperationKind } from '../execution/execution-operation-kind.enum';
// eslint-disable-next-line max-len
import { ExecutionOperationRecoveryClass } from '../execution/execution-operation-recovery-class.enum';
import { executionTaskWork } from '../execution/execution-task-payload.types';
import { ExecutionStepKind } from '../execution/execution-step-kind.enum';
import { extractTextFromHtml } from '../utils/text';
import { buildReductionTree } from './reduction-tree';
import { chunkTextParts } from './text-chunks';

const MAP_WORD_BUDGET = 700;
const MAP_UNIT_BUDGET = 3;
const COMPOSITION_MAP_FAN_IN = 3;
const FINALIZATION_FAN_IN = 7;
type WorkflowStep = Omit<CreateExecutionStepInput, 'executionId'>;

export function buildSummarizeWorkflowSteps(
  content: string,
  targetLanguage: string,
  sourceLanguage?: string,
): Array<Omit<CreateExecutionStepInput, 'executionId'>> {
  const extracted = extractTextFromHtml(content);
  const chunks = chunkTextParts(
    extracted.length ? extracted : [{ text: content }],
    MAP_WORD_BUDGET,
    MAP_UNIT_BUDGET,
  );
  if (!chunks.length) throw new Error('Summarization content is empty');

  const mapSteps = chunks.map((chunk, chunkIndex) => ({
    stepId: randomUUID(),
    stepKind: ExecutionStepKind.INFERENCE,
    work: {
      ...executionTaskWork('summarize-map', {
        content: chunk,
        chunkIndex,
        targetLanguage,
        sourceLanguage,
      }),
    },
    requiredCapabilities: ['summarize-map'],
  }));
  const inventorySteps: WorkflowStep[] = [];
  const compositionSteps: WorkflowStep[] = [];
  for (
    let index = 0;
    index < mapSteps.length;
    index += COMPOSITION_MAP_FAN_IN
  ) {
    const dependencyStepIds = mapSteps
      .slice(index, index + COMPOSITION_MAP_FAN_IN)
      .map((step) => step.stepId);
    const inventoryStepId = randomUUID();
    inventorySteps.push({
      stepId: inventoryStepId,
      stepKind: ExecutionStepKind.CODE,
      dependsOnStepIds: dependencyStepIds,
      work: {
        ...executionTaskWork('summarize-reduce', {
          targetLanguage,
          sourceLanguage,
          reductionLevel: 1,
        }),
        coordination: {
          kind: 'map-reduce-reduce/1',
          mapStepIds: dependencyStepIds,
          resultKey: 'ideas',
        },
      },
      requiredCapabilities: ['summarize-reduce'],
      operationKind: ExecutionOperationKind.ARTIFACT_PROCESSING,
      recoveryClass: ExecutionOperationRecoveryClass.READ_ONLY_REPLAYABLE,
    });
    compositionSteps.push({
      stepId: randomUUID(),
      stepKind: ExecutionStepKind.INFERENCE,
      dependsOnStepIds: [inventoryStepId],
      work: {
        ...executionTaskWork('summarize-compose', {
          targetLanguage,
          sourceLanguage,
        }),
        coordination: {
          kind: 'map-reduce-reduce/1' as const,
          mapStepIds: [inventoryStepId],
          resultKey: 'ideas',
        },
      },
      requiredCapabilities: ['summarize-compose'],
    });
  }
  const finalizationSteps = buildReductionTree(
    compositionSteps,
    ({ dependencyStepIds, level, final }) => ({
      stepKind: ExecutionStepKind.CODE,
      dependsOnStepIds: dependencyStepIds,
      work: {
        ...executionTaskWork('summarize-finalize', {
          final,
          reductionLevel: level,
        }),
        coordination: {
          kind: 'map-reduce-reduce/1',
          mapStepIds: dependencyStepIds,
          resultKey: 'responses',
        },
      },
      requiredCapabilities: ['summarize-finalize'],
      operationKind: ExecutionOperationKind.ARTIFACT_PROCESSING,
      recoveryClass: ExecutionOperationRecoveryClass.READ_ONLY_REPLAYABLE,
    }),
    FINALIZATION_FAN_IN,
  );
  return [...mapSteps, ...inventorySteps, ...finalizationSteps];
}

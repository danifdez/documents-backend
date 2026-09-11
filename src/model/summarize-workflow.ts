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
const REDUCTION_FAN_IN = 7;

export function buildSummarizeWorkflowSteps(
  content: string,
  targetLanguage: string,
  sourceLanguage?: string,
): Array<Omit<CreateExecutionStepInput, 'executionId'>> {
  const extracted = extractTextFromHtml(content);
  const chunks = chunkTextParts(
    extracted.length ? extracted : [{ text: content }],
    MAP_WORD_BUDGET,
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
  return buildReductionTree(
    mapSteps,
    ({ dependencyStepIds, level, final }) => ({
      stepKind: ExecutionStepKind.CODE,
      dependsOnStepIds: dependencyStepIds,
      work: {
        ...executionTaskWork('summarize-reduce', {
          targetLanguage,
          sourceLanguage,
          final,
          reductionLevel: level,
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
    }),
    REDUCTION_FAN_IN,
  );
}

import { randomUUID } from 'crypto';
import { CreateExecutionStepInput } from '../execution/execution-control-plane.types';
import { executionTaskWork } from '../execution/execution-task-payload.types';
import { ExecutionStepKind } from '../execution/execution-step-kind.enum';
import { extractTextFromHtml } from '../utils/text';
import { chunkTextParts } from './text-chunks';

const MAP_WORD_BUDGET = 2_800;

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
  const dependencyStepIds = mapSteps.map((step) => step.stepId);
  const compositionStep = {
    stepId: randomUUID(),
    stepKind: ExecutionStepKind.INFERENCE,
    dependsOnStepIds: dependencyStepIds,
    work: {
      ...executionTaskWork('summarize-compose', {
        targetLanguage,
        sourceLanguage,
      }),
      coordination: {
        kind: 'map-reduce-reduce/1' as const,
        mapStepIds: dependencyStepIds,
        resultKey: 'ideas',
      },
    },
    requiredCapabilities: ['summarize-compose'],
  };
  return [...mapSteps, compositionStep];
}

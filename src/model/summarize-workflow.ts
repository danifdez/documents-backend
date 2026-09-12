import { CreateExecutionStepInput } from '../execution/execution-control-plane.types';
import { buildMapComposeWorkflow } from '../execution/map-reduce-workflow';
import { executionTaskWork } from '../execution/execution-task-payload.types';
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
  return buildMapComposeWorkflow({
    items: chunks,
    emptyInputError: 'Summarization content is empty',
    resultKey: 'ideas',
    map: (content, chunkIndex) => ({
      work: executionTaskWork('summarize-map', {
        content,
        chunkIndex,
        targetLanguage,
        sourceLanguage,
      }),
      requiredCapabilities: ['summarize-map'],
    }),
    compose: () => ({
      work: executionTaskWork('summarize-compose', {
        targetLanguage,
        sourceLanguage,
      }),
      requiredCapabilities: ['summarize-compose'],
    }),
  });
}

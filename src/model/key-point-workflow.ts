import { CreateExecutionStepInput } from '../execution/execution-control-plane.types';
import { buildMapReduceWorkflow } from '../execution/map-reduce-workflow';
import { executionTaskWork } from '../execution/execution-task-payload.types';
import { chunkTextParts } from './text-chunks';

const MAP_WORD_BUDGET = 1_500;

export function buildKeyPointWorkflowSteps(
  textParts: Array<{ text: string }>,
  targetLanguage: string,
): Array<Omit<CreateExecutionStepInput, 'executionId'>> {
  const chunks = chunkTextParts(textParts, MAP_WORD_BUDGET);
  return buildMapReduceWorkflow({
    items: chunks,
    emptyInputError: 'Key-point content is empty',
    map: (content, chunkIndex) => ({
      work: executionTaskWork('key-point-map', {
        content,
        chunkIndex,
        targetLanguage,
      }),
      requiredCapabilities: ['key-point-map'],
    }),
    reduce: () => ({
      work: executionTaskWork('key-point-reduce', { targetLanguage }),
      requiredCapabilities: ['key-point-reduce'],
      resultKey: 'key_points',
    }),
  });
}

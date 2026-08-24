import { randomUUID } from 'crypto';
import { CreateExecutionStepInput } from '../execution/execution-control-plane.types';
import { ExecutionStepKind } from '../execution/execution-step-kind.enum';
import { extractTextFromHtml } from '../utils/text';

const MAP_WORD_BUDGET = 1_500;

export function buildSummarizeWorkflowSteps(
  content: string,
  targetLanguage: string,
  sourceLanguage?: string,
): Array<Omit<CreateExecutionStepInput, 'executionId'>> {
  const text = extractTextFromHtml(content)
    .map((part) => part.text)
    .join('\n\n')
    .trim();
  const chunks = chunkWords(text || content, MAP_WORD_BUDGET);
  if (!chunks.length) throw new Error('Summarization content is empty');

  const mapSteps = chunks.map((chunk, chunkIndex) => ({
    stepId: randomUUID(),
    stepKind: ExecutionStepKind.INFERENCE,
    work: {
      taskType: 'summarize-map',
      payload: {
        content: chunk,
        chunkIndex,
        targetLanguage,
        sourceLanguage,
      },
    },
    requiredCapabilities: ['summarize-map'],
  }));
  const mapStepIds = mapSteps.map((step) => step.stepId);
  return [
    ...mapSteps,
    {
      stepKind: ExecutionStepKind.INFERENCE,
      dependsOnStepIds: mapStepIds,
      work: {
        taskType: 'summarize-reduce',
        payload: { targetLanguage, sourceLanguage },
        coordination: {
          kind: 'map-reduce-reduce/1',
          mapStepIds,
          resultKey: 'response',
        },
      },
      requiredCapabilities: ['summarize-reduce'],
    },
  ];
}

function chunkWords(text: string, maxWords: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  for (let index = 0; index < words.length; index += maxWords) {
    chunks.push(words.slice(index, index + maxWords).join(' '));
  }
  return chunks;
}

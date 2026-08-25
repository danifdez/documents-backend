import { randomUUID } from 'crypto';
import { CreateExecutionStepInput } from '../execution/execution-control-plane.types';
import { ExecutionOperationKind } from '../execution/execution-operation-kind.enum';
import { ExecutionOperationRecoveryClass } from '../execution/execution-operation-recovery-class.enum';
import { ExecutionStepKind } from '../execution/execution-step-kind.enum';

const MAP_WORD_BUDGET = 1_500;

export function buildEntityExtractionWorkflowSteps(
  textParts: Array<{ text: string }>,
): Array<Omit<CreateExecutionStepInput, 'executionId'>> {
  const chunks = chunkTextParts(textParts, MAP_WORD_BUDGET);
  if (!chunks.length) throw new Error('Entity extraction content is empty');

  const mapSteps = chunks.map((content, chunkIndex) => ({
    stepId: randomUUID(),
    stepKind: ExecutionStepKind.INFERENCE,
    work: {
      taskType: 'entity-extraction-map',
      payload: { content, chunkIndex },
    },
    requiredCapabilities: ['entity-extraction-map'],
  }));
  const mapStepIds = mapSteps.map((step) => step.stepId);

  return [
    ...mapSteps,
    {
      stepKind: ExecutionStepKind.CODE,
      dependsOnStepIds: mapStepIds,
      work: {
        taskType: 'entity-extraction-reduce',
        payload: {},
        coordination: {
          kind: 'map-reduce-reduce/1',
          mapStepIds,
          resultKey: 'entities',
        },
      },
      requiredCapabilities: ['entity-extraction-reduce'],
      operationKind: ExecutionOperationKind.ARTIFACT_PROCESSING,
      recoveryClass: ExecutionOperationRecoveryClass.READ_ONLY_REPLAYABLE,
    },
  ];
}

function chunkTextParts(
  textParts: Array<{ text: string }>,
  maxWords: number,
): string[] {
  const units = textParts
    .map(({ text }) => sanitizeText(text).trim())
    .filter(Boolean)
    .flatMap((text) => splitWords(text, maxWords));
  const chunks: string[] = [];
  let current: string[] = [];
  let currentWords = 0;

  for (const unit of units) {
    const unitWords = wordCount(unit);
    if (current.length && currentWords + unitWords > maxWords) {
      chunks.push(current.join('\n\n'));
      current = [];
      currentWords = 0;
    }
    current.push(unit);
    currentWords += unitWords;
  }
  if (current.length) chunks.push(current.join('\n\n'));
  return chunks;
}

function sanitizeText(text: string): string {
  return text
    .replace(/data:[a-zA-Z0-9+./;=-]*;base64,[A-Za-z0-9+/=]+/g, '[image]')
    .replace(/\S{2000,}/g, '[blob]');
}

function splitWords(text: string, maxWords: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const parts: string[] = [];
  for (let index = 0; index < words.length; index += maxWords) {
    parts.push(words.slice(index, index + maxWords).join(' '));
  }
  return parts;
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

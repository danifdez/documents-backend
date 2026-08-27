import { randomUUID } from 'crypto';
import { CreateExecutionStepInput } from '../execution/execution-control-plane.types';
import { ExecutionOperationKind } from '../execution/execution-operation-kind.enum';
// eslint-disable-next-line max-len
import { ExecutionOperationRecoveryClass } from '../execution/execution-operation-recovery-class.enum';
import { ExecutionStepKind } from '../execution/execution-step-kind.enum';
import { buildReductionTree } from './reduction-tree';

const MAP_BATCH_SIZE = 32;
const MAX_WORDS_PER_PIECE = 400;

export type TranslationResponseMode = 'items' | 'targets';

export interface TranslationTextItem {
  text: string;
  path?: string;
}

interface TranslationUnit {
  itemIndex: number;
  pieceIndex: number;
  text: string;
  originalText: string;
  path?: string;
}

export function buildTranslateWorkflowSteps(input: {
  texts: Array<string | TranslationTextItem>;
  sourceLanguage: string;
  targetLanguages: string[];
  responseMode: TranslationResponseMode;
}): Array<Omit<CreateExecutionStepInput, 'executionId'>> {
  if (!input.texts.length) throw new Error('Translation texts are required');
  if (!input.targetLanguages.length) {
    throw new Error('Translation target languages are required');
  }
  if (
    !input.sourceLanguage ||
    input.targetLanguages.some((language) => !language) ||
    new Set(input.targetLanguages).size !== input.targetLanguages.length
  ) {
    throw new Error('Translation languages must be non-empty and unique');
  }
  if (input.responseMode === 'items' && input.targetLanguages.length !== 1) {
    throw new Error('Item translation requires exactly one target language');
  }
  if (input.responseMode === 'targets' && input.texts.length !== 1) {
    throw new Error('Target translation requires exactly one text item');
  }

  const units: TranslationUnit[] = input.texts.flatMap((item, itemIndex) => {
    const normalized = normalizeTextItem(item);
    return splitText(normalized.text).map((text, pieceIndex) => ({
      itemIndex,
      pieceIndex,
      text,
      originalText: normalized.text,
      ...(normalized.path === undefined ? {} : { path: normalized.path }),
    }));
  });
  const mapSteps = input.targetLanguages.flatMap((targetLanguage) =>
    batch(units, MAP_BATCH_SIZE).map((mapUnits, batchIndex) => ({
      stepId: randomUUID(),
      stepKind: ExecutionStepKind.INFERENCE,
      work: {
        taskType: 'translate-map',
        payload: {
          sourceLanguage: input.sourceLanguage,
          targetLanguage,
          batchIndex,
          units: mapUnits,
        },
      },
      requiredCapabilities: ['translate-map'],
    })),
  );

  return buildReductionTree(
    mapSteps,
    ({ dependencyStepIds, level, groupIndex, final }) => ({
      stepKind: ExecutionStepKind.CODE,
      dependsOnStepIds: dependencyStepIds,
      work: {
        taskType: 'translate-reduce',
        payload: {
          final,
          level,
          groupIndex,
          ...(final
            ? {
                responseMode: input.responseMode,
                itemCount: input.texts.length,
                targetLanguages: input.targetLanguages,
              }
            : {}),
        },
        coordination: {
          kind: 'map-reduce-reduce/1',
          mapStepIds: dependencyStepIds,
          resultKey: 'translations',
        },
      },
      requiredCapabilities: ['translate-reduce'],
      operationKind: ExecutionOperationKind.ARTIFACT_PROCESSING,
      recoveryClass: ExecutionOperationRecoveryClass.READ_ONLY_REPLAYABLE,
    }),
  );
}

function normalizeTextItem(item: string | TranslationTextItem) {
  if (typeof item === 'string') return { text: item };
  if (!item || typeof item.text !== 'string') {
    throw new Error('Translation text items must contain text');
  }
  return item;
}

function splitText(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  return batch(words, MAX_WORDS_PER_PIECE).map((part) => part.join(' '));
}

function batch<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

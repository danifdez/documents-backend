import * as cheerio from 'cheerio';
import { CreateExecutionStepInput } from '../execution/execution-control-plane.types';
import { ExecutionStepKind } from '../execution/execution-step-kind.enum';
import { buildMapComposeWorkflow } from '../execution/map-reduce-workflow';
import { executionTaskWork } from '../execution/execution-task-payload.types';
import { chunkTextParts } from './text-chunks';

const MAP_WORD_BUDGET = 2_800;
const RESOURCE_MIN_WORDS = 80;
const SELECTION_MIN_WORDS = 40;
const RESOURCE_DEFAULT_MAX_WORDS = 150;
const SELECTION_DEFAULT_MAX_WORDS = 80;

function resourceText(content: string): string {
  const $ = cheerio.load(content);
  const body = $('body');
  if (!body.children().length) return content;
  $('script, style, template, noscript').remove();
  $('br').replaceWith('\n');
  $('p, div, h1, h2, h3, h4, h5, h6, li, tr, section, article').after('\n');
  $('td, th').after(' ');
  return body.text().trim();
}

export function buildSummarizeWorkflowSteps(
  content: string,
  targetLanguage: string,
  sourceLanguage?: string,
  options: { selection?: boolean; plainText?: boolean; maxWords?: number } = {},
): Array<Omit<CreateExecutionStepInput, 'executionId'>> {
  const originalText =
    options.plainText || options.selection ? content : resourceText(content);
  const wordCount = (originalText.match(/\S+/gu) ?? []).length;
  if (!wordCount) throw new Error('Summarization content is empty');

  const requestedMax =
    options.maxWords ??
    (options.selection
      ? SELECTION_DEFAULT_MAX_WORDS
      : RESOURCE_DEFAULT_MAX_WORDS);
  if (!Number.isSafeInteger(requestedMax) || requestedMax < 1) {
    throw new Error('Summarization maximum must be a positive integer');
  }
  const minimum = options.selection ? SELECTION_MIN_WORDS : RESOURCE_MIN_WORDS;
  if (wordCount < minimum) {
    return [
      {
        stepKind: ExecutionStepKind.CODE,
        work: executionTaskWork('summarize-finalize', { originalText }),
        requiredCapabilities: ['summarize-finalize'],
      },
    ];
  }

  const maxWords = Math.min(requestedMax, wordCount - 1);
  const chunks = chunkTextParts([{ text: originalText }], MAP_WORD_BUDGET);
  return buildMapComposeWorkflow({
    items: chunks,
    emptyInputError: 'Summarization content is empty',
    resultKey: 'summary',
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
        maxWords,
      }),
      requiredCapabilities: ['summarize-compose'],
    }),
  });
}

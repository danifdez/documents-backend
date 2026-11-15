import { isChatTurnTaskType } from './execution.constants';

export function executionStepOutputValue(
  output: unknown,
  taskType?: string,
): unknown {
  if (!output || typeof output !== 'object') return output;
  const record = output as Record<string, unknown>;
  if (record.kind === 'inference') {
    const outcome = record.outcome as Record<string, unknown> | undefined;
    if (outcome?.kind === 'structured_result') return outcome.value;
    if (outcome?.kind === 'final_text') {
      if (isChatTurnTaskType(taskType ?? '')) {
        return { reply: outcome.text, error: null };
      }
      return outcome.text;
    }
    return outcome ?? null;
  }
  return Object.prototype.hasOwnProperty.call(record, 'value')
    ? record.value
    : record;
}

/** Project engine metadata without copying worker content into the event ledger. */
export function inferenceResultMetadata(result: Record<string, unknown>) {
  const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const count = (value: unknown): number | 'unknown' =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
      ? value
      : 'unknown';
  const usage = (value: unknown) => {
    const source = record(value);
    return {
      promptTokens: count(source.promptTokens),
      completionTokens: count(source.completionTokens),
      totalTokens: count(source.totalTokens),
    };
  };
  const details = (value: unknown): Record<string, unknown> => {
    const source = record(value);
    const projected: Record<string, unknown> = {};
    for (const key of ['requestedModel', 'effectiveModel']) {
      if (
        typeof source[key] === 'string' &&
        /^[A-Za-z0-9_.:-]{1,120}$/.test(source[key])
      ) {
        projected[key] = source[key];
      }
    }
    for (const [key, allowed] of Object.entries({
      finishReason: [
        'stop',
        'length',
        'tool_calls',
        'function_call',
        'content_filter',
        'unknown',
      ],
      cacheOutcome: ['hit', 'miss', 'unknown'],
      status: ['completed', 'incomplete'],
    })) {
      if (typeof source[key] === 'string' && allowed.includes(source[key])) {
        projected[key] = source[key];
      }
    }
    for (const key of ['inferenceMs', 'engineMs', 'callIndex']) {
      if (count(source[key]) !== 'unknown') projected[key] = source[key];
    }
    return projected;
  };
  const source = record(result.inference);
  const inference = details(source);
  const warnings = Array.isArray(source.warnings)
    ? source.warnings
        .filter(
          (value): value is string =>
            typeof value === 'string' && /^[a-z_]{1,100}$/.test(value),
        )
        .slice(0, 32)
    : [];
  inference.warnings = warnings;
  if (Array.isArray(source.calls)) {
    inference.calls = source.calls.slice(0, 128).map((value) => ({
      ...details(value),
      usage: usage(record(value).usage),
    }));
  }
  const tokens = usage(result.usage);
  return {
    inference,
    metrics: {
      durationMs: warnings.some((value) =>
        [
          'inference_time_unavailable',
          'inference_metadata_truncated',
          'inference_metadata_unavailable_after_cancellation',
        ].includes(value),
      )
        ? 'unknown'
        : count(source.inferenceMs),
      promptTokens: tokens.promptTokens,
      generatedTokens: tokens.completionTokens,
    },
  };
}

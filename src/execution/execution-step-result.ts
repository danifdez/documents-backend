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
      if (taskType === 'assistant-chat' || taskType === 'agent-chat') {
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

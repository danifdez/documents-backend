import {
  executionStepOutputValue,
  inferenceResultMetadata,
} from '../../../src/execution/execution-step-result';

describe('executionStepOutputValue', () => {
  it('maps a chat final_text outcome to the domain finalizer result', () => {
    expect(
      executionStepOutputValue(
        {
          kind: 'inference',
          outcome: { kind: 'final_text', text: 'Done' },
        },
        'assistant-chat',
      ),
    ).toEqual({ reply: 'Done', error: null });
  });

  it('keeps generic inference final_text outcomes as text', () => {
    expect(
      executionStepOutputValue({
        kind: 'inference',
        outcome: { kind: 'final_text', text: 'Done' },
      }),
    ).toBe('Done');
  });
});

describe('inferenceResultMetadata', () => {
  it('projects engine metadata without bodies or arbitrary worker fields', () => {
    const result = inferenceResultMetadata({
      usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
      inference: {
        requestedModel: 'requested',
        effectiveModel: 'served',
        finishReason: 'stop',
        inferenceMs: 25,
        engineMs: 20,
        cacheOutcome: 'hit',
        warnings: [],
        secret: 'PRIVATE',
        calls: [
          {
            effectiveModel: 'served',
            callIndex: 1,
            status: 'completed',
            response: 'PRIVATE',
            usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
          },
        ],
      },
    });
    expect(result.metrics).toEqual({
      promptTokens: 12,
      generatedTokens: 8,
      durationMs: 25,
    });
    expect(result.inference).toEqual(
      expect.objectContaining({
        effectiveModel: 'served',
        finishReason: 'stop',
      }),
    );
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('keeps unknown measurements separate from real zeroes and rejects unsafe metadata', () => {
    expect(
      inferenceResultMetadata({
        usage: { promptTokens: 0, completionTokens: null },
        inference: {
          effectiveModel: '/private/model',
          finishReason: 'PRIVATE',
          inferenceMs: 0,
          warnings: ['inference_time_unavailable'],
        },
      }),
    ).toEqual({
      inference: { inferenceMs: 0, warnings: ['inference_time_unavailable'] },
      metrics: {
        promptTokens: 0,
        generatedTokens: 'unknown',
        durationMs: 'unknown',
      },
    });
    expect(inferenceResultMetadata({}).metrics).toEqual({
      promptTokens: 'unknown',
      generatedTokens: 'unknown',
      durationMs: 'unknown',
    });
  });
});

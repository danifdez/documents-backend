import { executionStepOutputValue } from '../../../src/execution/execution-step-result';

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

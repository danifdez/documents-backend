// eslint-disable-next-line max-len
import { BrowserInferenceProcessor } from '../../../src/execution-processor/processors/browser-inference-processor';
import { ExecutionEntity } from '../../../src/execution/execution.entity';

describe('BrowserInferenceProcessor', () => {
  const executionId = '018f1d8a-54d7-7d63-a1ee-5e9a6adca701';
  const processor = new BrowserInferenceProcessor();

  it('publishes the terminal completion for a valid inference result', async () => {
    const execution = {
      executionId,
      taskType: 'browser-inference',
      result: { content: 'Response' },
    } as ExecutionEntity;

    await expect(processor.process(execution)).resolves.toEqual({
      success: true,
      publication: {
        socketEvent: 'browserInferenceResponse',
        payload: { executionId, status: 'completed' },
      },
    });
  });

  it('publishes the terminal failure when the result is invalid', async () => {
    const execution = {
      executionId,
      taskType: 'browser-inference',
      result: {},
    } as ExecutionEntity;

    await expect(processor.process(execution)).resolves.toEqual({
      success: false,
      reason: 'invalid_browser_inference_result',
      publication: {
        socketEvent: 'browserInferenceResponse',
        payload: { executionId, status: 'failed' },
      },
    });
  });
});

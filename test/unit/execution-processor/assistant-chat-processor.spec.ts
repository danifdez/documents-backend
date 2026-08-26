// Jest does not resolve the src alias here, and Prettier keeps module specifiers on one line.
// eslint-disable-next-line max-len
import { AssistantChatProcessor } from '../../../src/execution-processor/processors/assistant-chat-processor';
import { ExecutionEntity } from '../../../src/execution/execution.entity';

describe('AssistantChatProcessor final response', () => {
  const executionId = '018f1d8a-54d7-7d63-a1ee-5e9a6adca701';

  function build() {
    const executionService = {
      completeExecution: jest.fn(async () => undefined),
      validateDeterministicPartial: jest.fn(async () => undefined),
    };
    return {
      processor: new AssistantChatProcessor(executionService as any),
      executionService,
    };
  }

  it('persists and publishes the assistant final_text projection', async () => {
    const dependencies = build();
    const execution = {
      executionId,
      taskType: 'assistant-chat',
      payload: { ownerId: 7 },
      result: { reply: 'Final answer', error: null },
    } as ExecutionEntity;

    await expect(dependencies.processor.process(execution)).resolves.toEqual({
      success: true,
    });
    expect(
      dependencies.executionService.completeExecution,
    ).toHaveBeenCalledWith(executionId, 'Final answer', null, undefined);
  });

  it('selects agent finalization from taskType instead of payload metadata', async () => {
    const dependencies = build();
    const execution = {
      executionId,
      taskType: 'agent-chat',
      payload: { ownerId: 8 },
      result: { reply: 'Final answer', error: null },
    } as ExecutionEntity;

    await dependencies.processor.process(execution);

    expect(
      dependencies.executionService.completeExecution,
    ).toHaveBeenCalledWith(executionId, 'Final answer', null, undefined);
  });

  it('reuses the persisted message identity during finalizer replay', async () => {
    const dependencies = build();
    const execution = {
      executionId,
      taskType: 'agent-chat',
      payload: { ownerId: 8 },
      result: { reply: 'Final answer' },
    } as ExecutionEntity;

    await dependencies.processor.process(execution);
    await dependencies.processor.process(execution);

    expect(
      dependencies.executionService.completeExecution,
    ).toHaveBeenCalledTimes(2);
    expect(
      dependencies.executionService.completeExecution.mock.calls[1],
    ).toEqual(dependencies.executionService.completeExecution.mock.calls[0]);
  });

  it('validates a Backend-generated deterministic partial before publishing', async () => {
    const dependencies = build();
    const partialResult = {
      version: '1' as const,
      trigger: 'closing_output_empty' as const,
      loopId: executionId,
      grantId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca702',
      completedOperations: [],
      pending: ['final_synthesis'] as ['final_synthesis'],
    };
    const execution = {
      executionId,
      taskType: 'assistant-chat',
      payload: { ownerId: 7 },
      result: {
        reply: 'Completed work',
        completionKind: 'partial',
        completionReason: 'budget_exhausted',
        completionSource: 'runtime_template',
        partialResult,
      },
    } as ExecutionEntity;

    await dependencies.processor.process(execution);

    const completion = {
      kind: 'partial',
      reason: 'budget_exhausted',
      source: 'runtime_template',
      partialResult,
    };
    expect(
      dependencies.executionService.validateDeterministicPartial,
    ).toHaveBeenCalledWith(executionId, 'Completed work', null, completion);
    expect(
      dependencies.executionService.completeExecution,
    ).toHaveBeenCalledWith(executionId, 'Completed work', null, completion);
  });

  it('rejects finalization without the owner identity', async () => {
    const dependencies = build();
    const execution = {
      executionId,
      taskType: 'assistant-chat',
      payload: {},
      result: { reply: 'Final answer' },
    } as ExecutionEntity;

    await expect(dependencies.processor.process(execution)).resolves.toEqual({
      success: false,
    });
    expect(
      dependencies.executionService.completeExecution,
    ).not.toHaveBeenCalled();
  });
});

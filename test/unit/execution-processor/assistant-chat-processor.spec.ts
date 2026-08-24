// Jest does not resolve the src alias here, and Prettier keeps module specifiers on one line.
// eslint-disable-next-line max-len
import { AssistantChatProcessor } from '../../../src/execution-processor/processors/assistant-chat-processor';
import { ExecutionEntity } from '../../../src/execution/execution.entity';

describe('AssistantChatProcessor final response', () => {
  const executionId = '018f1d8a-54d7-7d63-a1ee-5e9a6adca701';

  function build() {
    const assistantMessage = {
      id: 12,
      assistantId: 7,
      role: 'assistant',
      content: 'Final answer',
      executionId,
      error: null,
      event: null,
      createdAt: new Date('2026-08-20T10:00:00Z'),
    };
    const agentMessage = {
      id: 11,
      agentId: 8,
      role: 'assistant' as const,
      content: 'Final answer',
      executionId,
      error: null,
      event: null,
      createdAt: new Date('2026-08-20T10:00:00Z'),
    };
    const assistantService = {
      recordAssistantReply: jest.fn(async () => assistantMessage),
    };
    const agentService = {
      recordAgentReply: jest.fn(async () => agentMessage),
    };
    const executionService = {
      completeExecution: jest.fn(async () => undefined),
      validateDeterministicPartial: jest.fn(async () => undefined),
    };
    return {
      processor: new AssistantChatProcessor(
        assistantService as any,
        agentService as any,
        executionService as any,
      ),
      assistantService,
      agentService,
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
      dependencies.assistantService.recordAssistantReply,
    ).toHaveBeenCalledWith(7, 'Final answer', executionId, null);
    expect(
      dependencies.executionService.completeExecution,
    ).toHaveBeenCalledWith(executionId, 'Final answer', null, undefined, {
      socketEvent: 'assistantResponse',
      payload: {
        assistantId: 7,
        executionId,
        message: expect.objectContaining({ id: 12, content: 'Final answer' }),
      },
    });
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

    expect(dependencies.agentService.recordAgentReply).toHaveBeenCalledWith(
      8,
      'Final answer',
      executionId,
      null,
    );
    expect(
      dependencies.assistantService.recordAssistantReply,
    ).not.toHaveBeenCalled();
    expect(
      dependencies.executionService.completeExecution,
    ).toHaveBeenCalledWith(
      executionId,
      'Final answer',
      null,
      undefined,
      expect.objectContaining({ socketEvent: 'agentResponse' }),
    );
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

    const publications = dependencies.executionService.completeExecution.mock
      .calls as unknown[][];
    expect(publications).toHaveLength(2);
    expect(publications[1][4]).toEqual(publications[0][4]);
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
    ).toHaveBeenCalledWith(
      executionId,
      'Completed work',
      null,
      completion,
      expect.objectContaining({ socketEvent: 'assistantResponse' }),
    );
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

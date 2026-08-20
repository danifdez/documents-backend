// Jest does not resolve the src alias here, and Prettier keeps module specifiers on one line.
// eslint-disable-next-line max-len
import { AssistantChatProcessor } from '../../../src/execution-processor/processors/assistant-chat-processor';
import { ExecutionEntity } from '../../../src/execution/execution.entity';

describe('AssistantChatProcessor final response', () => {
  const executionId = '018f1d8a-54d7-7d63-a1ee-5e9a6adca701';

  function build() {
    const notificationGateway = {
      sendAssistantResponse: jest.fn(),
      sendAgentResponse: jest.fn(),
    };
    const assistantService = {
      recordAssistantReply: jest.fn(
        async (
          assistantId: number,
          reply: string,
          currentExecutionId: string,
          error: string | null,
        ) => ({ assistantId, reply, currentExecutionId, error }),
      ),
    };
    const memoryService = {};
    const agentMessage = {
      id: 11,
      agentId: 8,
      role: 'assistant' as const,
      content: 'Loop answer',
      executionId,
      error: null,
      event: null,
      createdAt: new Date('2026-08-20T10:00:00Z'),
    };
    const agentService = {
      recordAgentReply: jest.fn(async () => agentMessage),
    };
    const executionService = {
      completeExecution: jest.fn(async () => undefined),
    };
    const processor = new AssistantChatProcessor(
      notificationGateway as any,
      assistantService as any,
      memoryService as any,
      agentService as any,
      executionService as any,
    );
    return {
      processor,
      notificationGateway,
      assistantService,
      agentService,
      executionService,
      agentMessage,
    };
  }

  it('persists and publishes the assistant reply exactly as models returned it', async () => {
    const dependencies = build();
    const execution = {
      executionId,
      taskType: 'assistant-chat',
      payload: { kind: 'assistant', ownerId: 7 },
      result: {
        reply: 'Loop answer',
        executionTelemetry: { attemptedEvents: 3 },
      },
    } as ExecutionEntity;

    await dependencies.processor.process(execution);

    expect(
      dependencies.assistantService.recordAssistantReply,
    ).toHaveBeenCalledWith(7, 'Loop answer', executionId, null);
    expect(
      dependencies.executionService.completeExecution,
    ).toHaveBeenCalledWith(executionId, 'Loop answer', null, {
      attemptedEvents: 3,
    });
    expect(
      dependencies.notificationGateway.sendAssistantResponse,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ assistantId: 7, executionId }),
    );
  });

  it('persists and publishes the agent reply without requiring stream chunks', async () => {
    const dependencies = build();
    const execution = {
      executionId,
      taskType: 'agent-chat',
      payload: { kind: 'agent', ownerId: 8 },
      result: { reply: 'Loop answer' },
    } as ExecutionEntity;

    await dependencies.processor.process(execution);

    expect(dependencies.agentService.recordAgentReply).toHaveBeenCalledWith(
      8,
      'Loop answer',
      executionId,
      null,
    );
    expect(
      dependencies.executionService.completeExecution,
    ).toHaveBeenCalledWith(executionId, 'Loop answer', null, undefined);
    expect(
      dependencies.notificationGateway.sendAgentResponse,
    ).toHaveBeenCalledWith({
      agentId: 8,
      executionId,
      message: {
        id: 11,
        agentId: 8,
        role: 'assistant',
        content: 'Loop answer',
        executionId,
        error: null,
        event: null,
        createdAt: '2026-08-20T10:00:00.000Z',
      },
    });
  });

  it('preserves a reserved budget closure as an explicit partial result', async () => {
    const dependencies = build();
    const execution = {
      executionId,
      taskType: 'assistant-chat',
      payload: { kind: 'assistant', ownerId: 7 },
      result: {
        reply: 'Partial answer from completed tools',
        completionKind: 'partial',
        completionReason: 'budget_exhausted',
      },
    } as ExecutionEntity;

    await dependencies.processor.process(execution);

    expect(
      dependencies.executionService.completeExecution,
    ).toHaveBeenCalledWith(
      executionId,
      'Partial answer from completed tools',
      null,
      undefined,
      { kind: 'partial', reason: 'budget_exhausted' },
    );
    expect(
      dependencies.notificationGateway.sendAssistantResponse,
    ).toHaveBeenCalled();
  });

  it('persists and publishes a terminal model error without a final reply', async () => {
    const dependencies = build();
    const error = 'Model returned an empty response';
    const execution = {
      executionId,
      taskType: 'assistant-chat',
      payload: { kind: 'assistant', ownerId: 7 },
      result: { error },
    } as ExecutionEntity;

    await dependencies.processor.process(execution);

    expect(
      dependencies.assistantService.recordAssistantReply,
    ).toHaveBeenCalledWith(7, '', executionId, error);
    expect(
      dependencies.executionService.completeExecution,
    ).toHaveBeenCalledWith(executionId, '', error, undefined);
    expect(
      dependencies.notificationGateway.sendAssistantResponse,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ assistantId: 7, executionId }),
    );
  });

  it('preserves the explicit budget reason on a failed execution', async () => {
    const dependencies = build();
    const execution = {
      executionId,
      taskType: 'assistant-chat',
      payload: { kind: 'assistant', ownerId: 7 },
      result: {
        error: 'budget_empty_forced_finalization',
        completionReason: 'budget_exhausted',
      },
    } as ExecutionEntity;

    await dependencies.processor.process(execution);

    expect(
      dependencies.executionService.completeExecution,
    ).toHaveBeenCalledWith(
      executionId,
      '',
      'budget_empty_forced_finalization',
      undefined,
      { kind: undefined, reason: 'budget_exhausted' },
    );
    expect(
      dependencies.notificationGateway.sendAssistantResponse,
    ).toHaveBeenCalled();
  });
});

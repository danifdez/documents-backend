import { ExecutionEntity } from '../../../src/execution/execution.entity';
import {
  ChatMessageEntity,
  ExecutionConversationService,
} from '../../../src/execution/execution-conversation.service';
import { ConversationSessionEntity } from '../../../src/conversation/conversation-session.entity';
import {
  ConversationTurnEntity,
  ConversationTurnStatus,
} from '../../../src/conversation/conversation-turn.entity';
import { ConversationArtifactRevisionEntity } from '../../../src/conversation/conversation-artifact-revision.entity';
import { AssistantMessageEntity } from '../../../src/assistant/assistant-message.entity';

function createService(): ExecutionConversationService {
  return Object.create(ExecutionConversationService.prototype);
}

describe('ExecutionConversationService', () => {
  it('ignores executions that do not own a chat turn', async () => {
    const manager = { getRepository: jest.fn() };

    await expect(
      createService().finishConversationTurn(
        manager as any,
        { taskType: 'ask' } as ExecutionEntity,
        ConversationTurnStatus.COMPLETED,
      ),
    ).resolves.toBeNull();
    expect(manager.getRepository).not.toHaveBeenCalled();
  });

  it('cancels a queued turn without opening its conversation lane', async () => {
    const session = {
      sessionId: 'session-1',
      activeTurnId: 'active-turn',
      conversationRevision: 3,
    };
    const turn: any = {
      turnId: 'queued-turn',
      status: ConversationTurnStatus.QUEUED,
      version: 1,
    };
    const sessionRepo = {
      findOne: jest.fn().mockResolvedValue(session),
      save: jest.fn(),
    };
    const turnRepo = {
      findOne: jest.fn().mockResolvedValue(turn),
      save: jest.fn(async (value) => value),
    };
    const manager = {
      getRepository: jest.fn((entity) =>
        entity === ConversationSessionEntity ? sessionRepo : turnRepo,
      ),
    };

    await expect(
      createService().finishConversationTurn(
        manager as any,
        {
          taskType: 'assistant-chat',
          sessionId: session.sessionId,
          turnId: turn.turnId,
        } as ExecutionEntity,
        ConversationTurnStatus.CANCELLED,
      ),
    ).resolves.toBeNull();

    expect(turn.status).toBe(ConversationTurnStatus.CANCELLED);
    expect(turn.terminalConversationRevision).toBe(3);
    expect(turn.version).toBe(2);
    expect(turnRepo.save).toHaveBeenCalledWith(turn);
    expect(sessionRepo.save).not.toHaveBeenCalled();
    expect(session.activeTurnId).toBe('active-turn');
  });

  it('persists a reply and closes the active conversation revision', async () => {
    const createdAt = new Date('2026-09-18T16:31:55.000Z');
    const session = {
      sessionId: 'session-1',
      activeTurnId: 'turn-1',
      conversationArtifactId: 'conversation-artifact-1',
      conversationRevision: 1,
      version: 1,
    };
    const turn: any = {
      turnId: 'turn-1',
      status: ConversationTurnStatus.ACTIVE,
      version: 1,
    };
    const sessionRepo = {
      findOne: jest.fn().mockResolvedValue(session),
      save: jest.fn(async (value) => value),
    };
    const turnRepo = {
      findOne: jest.fn(async ({ where }) => (where.turnId ? turn : null)),
      save: jest.fn(async (value) => value),
    };
    const messageRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ ...value, id: 11, createdAt })),
    };
    const revisionRepo = {
      findOneByOrFail: jest.fn().mockResolvedValue({ messages: [] }),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity === ConversationSessionEntity) return sessionRepo;
        if (entity === ConversationTurnEntity) return turnRepo;
        if (entity === AssistantMessageEntity) return messageRepo;
        if (entity === ConversationArtifactRevisionEntity) return revisionRepo;
        throw new Error('Unexpected repository');
      }),
      query: jest.fn(),
    };
    const execution = {
      executionId: 'execution-1',
      taskType: 'assistant-chat',
      sessionId: session.sessionId,
      turnId: turn.turnId,
      payload: { ownerId: 7 },
    } as ExecutionEntity;

    const message = await createService().finishConversationTurn(
      manager as any,
      execution,
      ConversationTurnStatus.COMPLETED,
      { reply: 'Done', error: null },
    );

    expect(message).toMatchObject({
      id: 11,
      assistantId: 7,
      content: 'Done',
      turnId: turn.turnId,
    });
    expect(revisionRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactId: session.conversationArtifactId,
        revision: 2,
        messages: [expect.objectContaining({ messageId: 11, content: 'Done' })],
      }),
    );
    expect(turn.status).toBe(ConversationTurnStatus.COMPLETED);
    expect(turn.terminalConversationRevision).toBe(2);
    expect(session.activeTurnId).toBeNull();
    expect(session.conversationRevision).toBe(2);
    expect(sessionRepo.save).toHaveBeenCalledWith(session);
    expect(manager.query).toHaveBeenCalledWith(expect.any(String), [7]);
  });

  it.each([
    ['assistant-chat', 'assistantResponse', 'assistantId'],
    ['agent-chat', 'agentResponse', 'agentId'],
  ])(
    'builds the %s response publication without changing its payload',
    (taskType, socketEvent, ownerKey) => {
      const createdAt = new Date('2026-09-18T16:31:55.000Z');
      const execution = {
        executionId: 'execution-1',
        taskType,
        payload: { ownerId: 7 },
      } as ExecutionEntity;
      const message = {
        id: 11,
        role: 'assistant',
        content: 'Reply',
        executionId: execution.executionId,
        error: null,
        event: null,
        createdAt,
      } as ChatMessageEntity;

      expect(createService().chatPublication(execution, message)).toEqual({
        socketEvent,
        payload: {
          [ownerKey]: 7,
          executionId: execution.executionId,
          message: {
            id: 11,
            role: 'assistant',
            content: 'Reply',
            executionId: execution.executionId,
            error: null,
            event: null,
            createdAt: createdAt.toISOString(),
            [ownerKey]: 7,
          },
        },
      });
      expect(createService().chatPublication(execution, null)).toBeUndefined();
    },
  );
});

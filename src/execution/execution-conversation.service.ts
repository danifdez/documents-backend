import { lockExecutionRequest } from './execution-request';
import { ExecutionRequestEntity } from './execution-request.entity';
import { EXECUTION_UUID_PATTERN } from './execution.constants';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { executionTraceContext } from '../telemetry/telemetry';
import { FeatureFlagService } from '../common/feature-flags.service';
import { AGENT_DEFAULT_TTL_MS } from '../agent/agent.constants';
import { AgentMessageEntity } from '../agent/agent-message.entity';
import { AssistantMessageEntity } from '../assistant/assistant-message.entity';
import { buildActiveCapabilitySet } from '../conversation/active-capabilities';
import {
  ACTIVE_CONTEXT_ARTIFACT_ROLE,
  buildActiveConversationContext,
  freezeActiveContextArtifact,
} from '../conversation/conversation-context';
import {
  ConversationArtifactMessage,
  ConversationArtifactRevisionEntity,
} from '../conversation/conversation-artifact-revision.entity';
import {
  ConversationOwnerType,
  ConversationSessionEntity,
} from '../conversation/conversation-session.entity';
import {
  ConversationTurnEntity,
  ConversationTurnStatus,
} from '../conversation/conversation-turn.entity';
import { buildContextInputWorkflow } from '../conversation/context-input-workflow';
import { createSkillActivations } from '../conversation/skill-activation';
import { buildActiveMemoryContext } from '../memory/active-memory';
import { ExecutionPublication } from '../execution-outbox/execution-publication';
import { ExecutionArtifactEntity } from './execution-artifact.entity';
import { ExecutionArtifactStorageService } from './execution-artifact-storage.service';
import { contentHash, canonicalHash } from './execution-canonical';
import { EXECUTION_SCHEMA, isChatTurnTaskType } from './execution.constants';
import { redactExecutionText } from './execution-data-policy';
import { ExecutionEntity } from './execution.entity';
import { appendBackendExecutionEvent } from './execution-event.writer';
import { ExecutionPriority } from './execution-priority.enum';
import { EXECUTION_STEP_PRIORITY } from './execution-scheduling-policy';
import { ExecutionStatus } from './execution-status.enum';
import { ExecutionStepKind } from './execution-step-kind.enum';
import { createExecutionStep } from './execution-step.service';
import {
  ChatCreationPayloadByKind,
  ChatExecutionPayload,
  executionPayloadOwnerId,
  executionTaskWork,
} from './execution-task-payload.types';
import { ExecutionAccessScope } from './execution.types';

export type ChatMessageEntity = AssistantMessageEntity | AgentMessageEntity;

export interface ChatExecutionAcceptance {
  execution: ExecutionEntity;
  userMessage: ChatMessageEntity;
}

@Injectable()
export class ExecutionConversationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly artifactStorage: ExecutionArtifactStorageService,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  async finishConversationTurn(
    manager: EntityManager,
    execution: ExecutionEntity,
    status:
      | ConversationTurnStatus.COMPLETED
      | ConversationTurnStatus.FAILED
      | ConversationTurnStatus.CANCELLED,
    response?: { reply: string; error: string | null },
  ): Promise<ChatMessageEntity | null> {
    if (!isChatTurnTaskType(execution.taskType)) {
      return null;
    }
    if (!execution.sessionId || !execution.turnId) {
      throw new ConflictException('session_turn_mismatch');
    }

    const sessionRepo = manager.getRepository(ConversationSessionEntity);
    const turnRepo = manager.getRepository(ConversationTurnEntity);
    const session = await sessionRepo.findOne({
      where: { sessionId: execution.sessionId },
      lock: { mode: 'pessimistic_write' },
    });
    const turn = await turnRepo.findOne({
      where: { turnId: execution.turnId, sessionId: execution.sessionId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!session || !turn) throw new ConflictException('session_turn_mismatch');

    if (
      turn.status !== ConversationTurnStatus.ACTIVE ||
      session.activeTurnId !== turn.turnId
    ) {
      if (
        [
          ConversationTurnStatus.COMPLETED,
          ConversationTurnStatus.FAILED,
          ConversationTurnStatus.CANCELLED,
        ].includes(turn.status)
      ) {
        return this.findConversationReply(manager, execution);
      }
      if (
        turn.status === ConversationTurnStatus.QUEUED &&
        status === ConversationTurnStatus.CANCELLED
      ) {
        turn.status = ConversationTurnStatus.CANCELLED;
        turn.terminalConversationRevision = session.conversationRevision;
        turn.finishedAt = new Date();
        turn.version += 1;
        await turnRepo.save(turn);
        return null;
      }
      throw new ConflictException('conversation_lane_conflict');
    }

    let message: ChatMessageEntity | null = null;
    if (response) {
      message = await this.saveConversationReply(manager, execution, response);
      await this.appendConversationRevision(manager, session, {
        messageId: message.id,
        turnId: turn.turnId,
        role: 'assistant',
        content: response.reply,
        executionId: execution.executionId,
        error: response.error,
        createdAt: message.createdAt.toISOString(),
      });
      if (execution.taskType === 'assistant-chat') {
        await manager.query(
          `UPDATE "assistants" SET "last_seen_at" = now(), "updated_at" = now() WHERE "id" = $1`,
          [Number(executionPayloadOwnerId(execution.payload))],
        );
      } else {
        await manager.query(
          `UPDATE "agents"
           SET "last_seen_at" = now(),
               "expires_at" = CASE
                 WHEN "pinned" THEN NULL
                 ELSE now() + ($2 * interval '1 millisecond')
               END,
               "updated_at" = now()
           WHERE "id" = $1`,
          [
            Number(executionPayloadOwnerId(execution.payload)),
            AGENT_DEFAULT_TTL_MS,
          ],
        );
      }
    }

    turn.status = status;
    turn.terminalConversationRevision = session.conversationRevision;
    turn.finishedAt = new Date();
    turn.version += 1;
    session.activeTurnId = null;
    session.version += 1;
    await turnRepo.save(turn);
    await this.promoteNextConversationTurn(manager, session);
    await sessionRepo.save(session);
    return message;
  }

  private findConversationReply(
    manager: EntityManager,
    execution: ExecutionEntity,
  ): Promise<ChatMessageEntity | null> {
    const where = { turnId: execution.turnId!, role: 'assistant' as const };
    return execution.taskType === 'assistant-chat'
      ? manager.getRepository(AssistantMessageEntity).findOne({ where })
      : manager.getRepository(AgentMessageEntity).findOne({ where });
  }

  private async saveConversationReply(
    manager: EntityManager,
    execution: ExecutionEntity,
    response: { reply: string; error: string | null },
  ): Promise<ChatMessageEntity> {
    const ownerId = Number(executionPayloadOwnerId(execution.payload));
    if (!Number.isInteger(ownerId) || ownerId < 1) {
      throw new ConflictException('invalid_conversation_owner');
    }
    const existing = await this.findConversationReply(manager, execution);
    if (existing) {
      if (
        existing.content !== response.reply ||
        existing.error !== response.error
      ) {
        throw new ConflictException('conversation_reply_conflict');
      }
      return existing;
    }

    if (execution.taskType === 'assistant-chat') {
      const repo = manager.getRepository(AssistantMessageEntity);
      return repo.save(
        repo.create({
          assistantId: ownerId,
          role: 'assistant',
          content: response.reply,
          turnId: execution.turnId,
          executionId: execution.executionId,
          error: response.error,
          event: null,
        }),
      );
    }
    const repo = manager.getRepository(AgentMessageEntity);
    return repo.save(
      repo.create({
        agentId: ownerId,
        role: 'assistant',
        content: response.reply,
        turnId: execution.turnId,
        executionId: execution.executionId,
        error: response.error,
        event: null,
      }),
    );
  }

  private async appendConversationRevision(
    manager: EntityManager,
    session: ConversationSessionEntity,
    message: ConversationArtifactMessage,
  ): Promise<ConversationArtifactRevisionEntity> {
    const revisionRepo = manager.getRepository(
      ConversationArtifactRevisionEntity,
    );
    const previous = await revisionRepo.findOneByOrFail({
      artifactId: session.conversationArtifactId,
      revision: session.conversationRevision,
    });
    const messages = [...previous.messages, message];
    const revision = session.conversationRevision + 1;
    const stored = await revisionRepo.save(
      revisionRepo.create({
        artifactId: session.conversationArtifactId,
        revision,
        sessionId: session.sessionId,
        parentRevision: session.conversationRevision,
        contentHash: canonicalHash(messages),
        messages,
      }),
    );
    session.conversationRevision = revision;
    session.version += 1;
    return stored;
  }

  private async promoteNextConversationTurn(
    manager: EntityManager,
    session: ConversationSessionEntity,
  ): Promise<void> {
    const turnRepo = manager.getRepository(ConversationTurnEntity);
    const next = await turnRepo.findOne({
      where: {
        sessionId: session.sessionId,
        status: ConversationTurnStatus.QUEUED,
      },
      order: { createdAt: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });
    if (!next) return;

    const userMessage =
      session.ownerType === 'assistant'
        ? await manager.getRepository(AssistantMessageEntity).findOneByOrFail({
            turnId: next.turnId,
            role: 'user',
          })
        : await manager.getRepository(AgentMessageEntity).findOneByOrFail({
            turnId: next.turnId,
            role: 'user',
          });
    const revision = await this.appendConversationRevision(manager, session, {
      messageId: userMessage.id,
      turnId: next.turnId,
      role: 'user',
      content: userMessage.content,
      executionId: null,
      error: null,
      createdAt: userMessage.createdAt.toISOString(),
    });

    next.status = ConversationTurnStatus.ACTIVE;
    next.startingConversationRevision = session.conversationRevision;
    next.version += 1;
    session.activeTurnId = next.turnId;
    session.version += 1;
    await turnRepo.save(next);

    const executionRepo = manager.getRepository(ExecutionEntity);
    const nextExecution = await executionRepo.findOne({
      where: { executionId: next.rootExecutionId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!nextExecution?.lastEventId) {
      throw new ConflictException('queued_turn_execution_missing');
    }
    const activeContext = buildActiveConversationContext(revision);
    const ownerConfig = await this.conversationOwnerConfig(
      manager,
      session.ownerType,
      session.ownerId,
    );
    const activeCapabilities = await buildActiveCapabilitySet(manager, {
      ownerType: session.ownerType,
      ownerId: session.ownerId,
      ownerPrincipal: nextExecution.ownerPrincipal,
      folderScope: ownerConfig.folderScope,
      browserFederationEnabled: this.browserFederationEnabled(),
    });
    nextExecution.payload = {
      ...(nextExecution.payload ?? {}),
      folderScope: ownerConfig.folderScope,
      ...(session.ownerType === 'agent'
        ? { systemPrompt: ownerConfig.systemPrompt }
        : {}),
      ...activeContext,
      activeMemory: await buildActiveMemoryContext(
        manager,
        session.ownerType,
        session.ownerId,
        userMessage.content,
      ),
      activeCapabilities,
    };
    await executionRepo.save(nextExecution);
    await createSkillActivations(
      manager,
      nextExecution.executionId,
      activeCapabilities,
    );
    const requestArtifact = await manager
      .getRepository(ExecutionArtifactEntity)
      .findOneByOrFail({ artifactId: next.requestArtifactId });
    await this.createInitialChatSteps(
      manager,
      nextExecution,
      requestArtifact,
      userMessage.content,
      nextExecution.lastEventId,
    );
  }

  chatPublication(
    execution: ExecutionEntity,
    message: ChatMessageEntity | null,
  ): ExecutionPublication | undefined {
    if (!message) return undefined;
    const ownerId = Number(executionPayloadOwnerId(execution.payload));
    const payload = {
      id: message.id,
      role: message.role,
      content: message.content,
      executionId: message.executionId,
      error: message.error,
      event: message.event,
      createdAt: message.createdAt.toISOString(),
    };
    return execution.taskType === 'assistant-chat'
      ? {
          socketEvent: 'assistantResponse',
          payload: {
            assistantId: ownerId,
            executionId: execution.executionId,
            message: { ...payload, assistantId: ownerId },
          },
        }
      : {
          socketEvent: 'agentResponse',
          payload: {
            agentId: ownerId,
            executionId: execution.executionId,
            message: { ...payload, agentId: ownerId },
          },
        };
  }

  async createForChat<TExecutionKind extends keyof ChatCreationPayloadByKind>(
    executionKind: TExecutionKind,
    message: string,
    scope: ExecutionAccessScope,
    payload: ChatCreationPayloadByKind[TExecutionKind],
    requestId?: string,
  ): Promise<ChatExecutionAcceptance> {
    const executionId = randomUUID();
    const rootExecutionId = executionId;
    const sessionId = randomUUID();
    const turnId = randomUUID();
    const artifactId = randomUUID();
    const conversationArtifactId = randomUUID();
    const sourceId = randomUUID();
    const safeMessage = redactExecutionText(message);
    const body = Buffer.from(safeMessage, 'utf8');
    const ownerType: ConversationOwnerType =
      executionKind === 'assistant_chat' ? 'assistant' : 'agent';
    const ownerId = Number(payload.ownerId);
    if (!Number.isInteger(ownerId) || ownerId < 1) {
      throw new BadRequestException('invalid_conversation_owner');
    }

    return this.dataSource.transaction(async (manager) => {
      const acceptance =
        requestId === undefined
          ? null
          : await lockExecutionRequest(manager, requestId, scope);
      if (acceptance) {
        const inputHash = canonicalHash({
          operation: 'conversation-message',
          executionKind,
          ownerId,
          message,
        });
        if (acceptance.inputHash && acceptance.inputHash !== inputHash) {
          throw new ConflictException('execution_request_conflict');
        }
        if (acceptance.executionId) {
          return this.acceptedChat(
            manager,
            acceptance.executionId,
            scope,
            executionKind,
            ownerId,
          );
        }
        if (acceptance.cancelRequested)
          throw new ConflictException('execution_request_cancelled');
        acceptance.inputHash = inputHash;
      }
      const ownerConfig = await this.conversationOwnerConfig(
        manager,
        ownerType,
        ownerId,
        true,
      );
      const canonicalPayload = {
        ...payload,
        folderScope: ownerConfig.folderScope,
        ...(ownerType === 'agent'
          ? { systemPrompt: ownerConfig.systemPrompt }
          : {}),
      };

      const sessionRepo = manager.getRepository(ConversationSessionEntity);
      let session = await sessionRepo.findOne({
        where: { ownerType, ownerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!session) {
        session = await sessionRepo.save(
          sessionRepo.create({
            sessionId,
            ownerType,
            ownerId,
            conversationArtifactId,
            conversationRevision: 0,
            activeTurnId: null,
            version: 1,
          }),
        );
      }

      const obtainsLane = session.activeTurnId === null;
      const startingRevision = obtainsLane
        ? session.conversationRevision + 1
        : session.conversationRevision;
      const turnRepo = manager.getRepository(ConversationTurnEntity);
      const turn = await turnRepo.save(
        turnRepo.create({
          turnId,
          sessionId: session.sessionId,
          rootExecutionId,
          requestArtifactId: artifactId,
          requestArtifactRevision: 1,
          startingConversationRevision: startingRevision,
          terminalConversationRevision: null,
          status: obtainsLane
            ? ConversationTurnStatus.ACTIVE
            : ConversationTurnStatus.QUEUED,
          version: 1,
          finishedAt: null,
        }),
      );

      const messageRepo = manager.getRepository(
        ownerType === 'assistant' ? AssistantMessageEntity : AgentMessageEntity,
      );
      const userMessage = await messageRepo.save(
        messageRepo.create({
          [`${ownerType}Id`]: ownerId,
          role: 'user',
          content: safeMessage,
          turnId,
          executionId: null,
          error: null,
          event: null,
        }),
      );

      const revisionRepo = manager.getRepository(
        ConversationArtifactRevisionEntity,
      );
      const previous = session.conversationRevision
        ? await revisionRepo.findOneByOrFail({
            artifactId: session.conversationArtifactId,
            revision: session.conversationRevision,
          })
        : null;
      const userArtifactMessage: ConversationArtifactMessage = {
        messageId: userMessage.id,
        turnId,
        role: 'user',
        content: safeMessage,
        executionId: null,
        error: null,
        createdAt: userMessage.createdAt.toISOString(),
      };
      const conversationMessages: ConversationArtifactMessage[] = obtainsLane
        ? [...(previous?.messages ?? []), userArtifactMessage]
        : (previous?.messages ?? []);
      let activeRevision: ConversationArtifactRevisionEntity | null = null;
      if (obtainsLane) {
        activeRevision = await revisionRepo.save(
          revisionRepo.create({
            artifactId: session.conversationArtifactId,
            revision: startingRevision,
            sessionId: session.sessionId,
            parentRevision: session.conversationRevision || null,
            contentHash: canonicalHash(conversationMessages),
            messages: conversationMessages,
          }),
        );
        session.conversationRevision = startingRevision;
      }
      session.version += 1;
      if (obtainsLane) session.activeTurnId = turn.turnId;
      await sessionRepo.save(session);

      const activeCapabilities = activeRevision
        ? await buildActiveCapabilitySet(manager, {
            ownerType,
            ownerId,
            ownerPrincipal: scope.ownerPrincipal,
            folderScope: ownerConfig.folderScope,
            browserFederationEnabled: this.browserFederationEnabled(),
          })
        : null;
      const executionPayload = activeRevision
        ? {
            ...canonicalPayload,
            ...buildActiveConversationContext(activeRevision),
            activeMemory: await buildActiveMemoryContext(
              manager,
              ownerType,
              ownerId,
              safeMessage,
            ),
            activeCapabilities,
          }
        : canonicalPayload;
      const execution = manager.getRepository(ExecutionEntity).create({
        executionId,
        rootExecutionId,
        parentExecutionId: null,
        sessionId: session.sessionId,
        turnId,
        ownerPrincipal: scope.ownerPrincipal,
        schemaVersion: EXECUTION_SCHEMA,
        taskType:
          executionKind === 'assistant_chat' ? 'assistant-chat' : 'agent-chat',
        payload: executionPayload,
        traceContext: executionTraceContext(),
        status: ExecutionStatus.QUEUED,
        phase: null,
        cancellationRequestedAt: null,
        cancellationReason: null,
        completionKind: null,
        completionReason: null,
        result: null,
        error: null,
        progressPolicy: null,
        progressLedger: null,
        completedAt: null,
        lastSequence: '0',
        lastEventId: null,
        completenessStatus: 'reproducible',
        missingEvidence: [],
      });
      await manager.save(execution);
      const requestArtifact = await this.artifactStorage.save(manager, {
        artifactId,
        rootExecutionId,
        kind: 'user_message',
        contentHash: contentHash(body),
        size: String(body.length),
        mediaType: 'text/plain',
        encoding: 'identity',
        dataClassification: 'workspace',
        redaction: { applied: safeMessage !== message },
        retentionClass: 'evaluation',
        createdByEventId: null,
        inputSourceIds: [sourceId],
        body,
      });
      const createdEvent = await appendBackendExecutionEvent(
        manager,
        execution,
        1,
        {
          eventType: 'execution.created',
          payloadSchema: 'execution.created/1',
          payload: {
            executionKind,
            initialStatus: 'queued',
          },
          actor: { type: 'system' },
          executionId,
          turnId,
          artifactRefs: [],
        },
        1,
      );
      const messageEvent = await appendBackendExecutionEvent(
        manager,
        execution,
        2,
        {
          eventType: 'message.recorded',
          payloadSchema: 'message.recorded/1',
          payload: {
            messageKind: 'user_input',
            role: 'user',
            contentPreview: safeMessage.slice(0, 512),
            contentArtifactId: artifactId,
            format: 'text',
          },
          actor: { type: 'user', id: scope.ownerPrincipal },
          executionId,
          turnId,
          causedByEventId: createdEvent.eventId,
          artifactRefs: [artifactId],
          redactionApplied: safeMessage !== message,
        },
        2,
      );
      const sourceEvent = await appendBackendExecutionEvent(
        manager,
        execution,
        3,
        {
          eventType: 'source.observed',
          payloadSchema: 'source.observed/1',
          payload: {
            sourceId,
            kind: 'user_input',
            originComponent: 'documents-backend',
            observedAt: new Date().toISOString(),
            contentHash: contentHash(body),
            snapshotArtifactId: artifactId,
            trustLevel: 'user_instruction',
            dataClassification: 'workspace',
          },
          actor: { type: 'user', id: scope.ownerPrincipal },
          executionId,
          turnId,
          sourceId,
          causedByEventId: messageEvent.eventId,
          artifactRefs: [artifactId],
          redactionApplied: safeMessage !== message,
        },
        3,
      );
      execution.lastSequence = '3';
      execution.lastEventId = sourceEvent.eventId;
      if (obtainsLane) {
        await createSkillActivations(
          manager,
          execution.executionId,
          activeCapabilities!,
        );
        await this.createInitialChatSteps(
          manager,
          execution,
          requestArtifact,
          safeMessage,
          sourceEvent.eventId,
        );
      }
      const saved = await manager.save(execution);
      if (acceptance) {
        acceptance.executionId = saved.executionId;
        await manager.getRepository(ExecutionRequestEntity).save(acceptance);
      }
      return { execution: saved, userMessage };
    });
  }

  async readChatRequest(
    requestId: string,
    scope: ExecutionAccessScope,
    assistantId: number,
  ): Promise<ChatExecutionAcceptance> {
    if (!EXECUTION_UUID_PATTERN.test(requestId))
      throw new BadRequestException('Invalid execution request identity');
    const receipt = await this.dataSource
      .getRepository(ExecutionRequestEntity)
      .findOneBy({ ownerPrincipal: scope.ownerPrincipal, requestId });
    if (!receipt?.executionId)
      throw new NotFoundException('Message request not found');
    return this.acceptedChat(
      this.dataSource.manager,
      receipt.executionId,
      scope,
      'assistant_chat',
      assistantId,
    );
  }

  private async acceptedChat(
    manager: EntityManager,
    executionId: string,
    scope: ExecutionAccessScope,
    kind: keyof ChatCreationPayloadByKind,
    ownerId: number,
  ): Promise<ChatExecutionAcceptance> {
    const execution = await manager.getRepository(ExecutionEntity).findOneBy({
      executionId,
      rootExecutionId: executionId,
      ownerPrincipal: scope.ownerPrincipal,
    });
    const expectedType =
      kind === 'assistant_chat' ? 'assistant-chat' : 'agent-chat';
    if (
      !execution ||
      !execution.turnId ||
      execution.taskType !== expectedType ||
      Number(executionPayloadOwnerId(execution.payload)) !== ownerId
    ) {
      throw new NotFoundException('Message request not found');
    }
    const userMessage = await manager
      .getRepository(
        kind === 'assistant_chat' ? AssistantMessageEntity : AgentMessageEntity,
      )
      .findOneBy({
        turnId: execution.turnId,
        role: 'user',
        ...(kind === 'assistant_chat'
          ? { assistantId: ownerId }
          : { agentId: ownerId }),
      });
    if (!userMessage)
      throw new ConflictException('execution_request_unavailable');
    return { execution, userMessage };
  }

  private async conversationOwnerConfig(
    manager: EntityManager,
    ownerType: ConversationOwnerType,
    ownerId: number,
    lock = false,
  ): Promise<{ folderScope: string | null; systemPrompt: string | null }> {
    const table = ownerType === 'assistant' ? 'assistants' : 'agents';
    const systemPrompt =
      ownerType === 'assistant'
        ? 'NULL::text AS "systemPrompt"'
        : '"system_prompt" AS "systemPrompt"';
    const rows = await manager.query(
      `SELECT "folder_scope" AS "folderScope", ${systemPrompt}
       FROM "${table}" WHERE "id" = $1${lock ? ' FOR UPDATE' : ''}`,
      [ownerId],
    );
    if (!rows.length) throw new NotFoundException(`${ownerType}_not_found`);
    return {
      folderScope:
        typeof rows[0].folderScope === 'string' ? rows[0].folderScope : null,
      systemPrompt:
        typeof rows[0].systemPrompt === 'string' ? rows[0].systemPrompt : null,
    };
  }

  private async createInitialChatSteps(
    manager: EntityManager,
    execution: ExecutionEntity,
    requestArtifact: ExecutionArtifactEntity,
    message: string,
    causedByEventId: string,
  ): Promise<void> {
    if (!isChatTurnTaskType(execution.taskType)) {
      throw new ConflictException('invalid_chat_execution_type');
    }
    const taskType =
      execution.taskType === 'assistant-chat' ? 'assistant-chat' : 'agent-chat';
    const effectivePayload = execution.payload as ChatExecutionPayload;
    const workflow = await buildContextInputWorkflow(
      manager,
      this.artifactStorage,
      {
        executionId: execution.executionId,
        taskType,
        message,
        requestArtifact,
        effectivePayload,
        causedByEventId,
      },
    );
    if (workflow) {
      for (const step of workflow.steps) {
        await createExecutionStep(manager, {
          ...step,
          executionId: execution.executionId,
        });
      }
      return;
    }

    const contextArtifact = await freezeActiveContextArtifact(
      manager,
      this.artifactStorage,
      {
        rootExecutionId: execution.rootExecutionId,
        sessionId: execution.sessionId,
        turnId: execution.turnId,
        causedByEventId,
        effectivePayload,
        derivedFromArtifactIds: [requestArtifact.artifactId],
      },
    );
    await createExecutionStep(manager, {
      executionId: execution.executionId,
      stepKind: ExecutionStepKind.INFERENCE,
      inputArtifactRefs: [
        { role: 'user_message', artifactId: requestArtifact.artifactId },
        {
          role: ACTIVE_CONTEXT_ARTIFACT_ROLE,
          artifactId: contextArtifact.artifactId,
        },
      ],
      work: {
        ...executionTaskWork(taskType, effectivePayload),
        agentLoop: {
          schemaVersion: 'agent-inference/1',
          purpose: 'normal',
          phase: 'agent_loop',
          sourceStepId: null,
          evidenceStepIds: [],
        },
      },
      requiredCapabilities: [execution.taskType],
      priority: EXECUTION_STEP_PRIORITY[ExecutionPriority.HIGH],
      causedByEventId,
    });
  }

  private browserFederationEnabled(): boolean {
    return this.featureFlags.isEnabled('browser_federation');
  }
}

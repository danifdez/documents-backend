import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager, In, MoreThan, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { ExecutionEntity } from './execution.entity';
import { ExecutionEventEntity } from './execution-event.entity';
import { ExecutionArtifactEntity } from './execution-artifact.entity';
import {
  IncomingExecutionArtifact,
  ExecutionAccessScope,
  ExecutionCompletion,
  DeterministicPartialResult,
} from './execution.types';
import {
  EXECUTION_EVENT_PAYLOADS,
  EXECUTION_BUNDLE_SCHEMA,
  EXECUTION_CONTENT_HASH_PATTERN,
  EXECUTION_CONTRACT_SET_HASH,
  EXECUTION_EVENT_SCHEMA,
  EXECUTION_SCHEMA,
  EXECUTION_UUID_PATTERN,
} from './execution.constants';
import { CreateExecutionStepInput } from './execution-control-plane.types';
import { ExecutionStepEntity } from './execution-step.entity';
import { ExecutionStepKind } from './execution-step-kind.enum';
import { ExecutionStepStatus } from './execution-step-status.enum';
import { ExecutionStepAttemptEntity } from './execution-step-attempt.entity';
import { createExecutionStep } from './execution-step.service';
import { ExecutionContractValidator } from './execution-contract-validator';
import { ExecutionPriority } from './execution-priority.enum';
import { ExecutionStatus } from './execution-status.enum';
import { ExecutionProgressService } from './execution-progress.service';
import { ExecutionResultReceiptEntity } from './execution-result-receipt.entity';
import { ExecutionToolPlanEntity } from './execution-tool-plan.entity';
import {
  ExecutionOutboxEntity,
  ExecutionOutboxStatus,
} from '../execution-outbox/execution-outbox.entity';
import { ExecutionPublication } from '../execution-outbox/execution-publication';
import { canonicalHash, contentHash } from './execution-canonical';
import {
  appendBackendExecutionEvent,
  BackendExecutionEventData,
  nextBackendProducerSequence,
} from './execution-event.writer';
import { WorkerEntity } from '../worker/worker.entity';
import {
  ConversationOwnerType,
  ConversationSessionEntity,
} from '../conversation/conversation-session.entity';
import {
  ConversationTurnEntity,
  ConversationTurnStatus,
} from '../conversation/conversation-turn.entity';
import {
  ConversationArtifactMessage,
  ConversationArtifactRevisionEntity,
} from '../conversation/conversation-artifact-revision.entity';
import { AssistantMessageEntity } from '../assistant/assistant-message.entity';
import { AgentMessageEntity } from '../agent/agent-message.entity';
import { AGENT_DEFAULT_TTL_MS } from '../agent/agent.constants';
import {
  ACTIVE_CONTEXT_ARTIFACT_ROLE,
  buildActiveConversationContext,
  freezeActiveContextArtifact,
} from '../conversation/conversation-context';
import { buildActiveMemoryContext } from '../memory/active-memory';
import { buildActiveCapabilitySet } from '../conversation/active-capabilities';
import { buildContextInputWorkflow } from '../conversation/context-input-workflow';
import {
  createSkillActivations,
  finishSkillActivations,
} from '../conversation/skill-activation';
import { SkillActivationEntity } from '../conversation/skill-activation.entity';
import {
  ChatCreationPayloadByKind,
  ChatExecutionPayload,
  ExecutionTaskPayload,
  ExecutionTaskType,
  ExecutionTaskWork,
  executionPayloadOwnerId,
  executionTaskWork,
} from './execution-task-payload.types';

export {
  canonicalDomainHash,
  canonicalHash,
  canonicalJson,
  contentHash,
} from './execution-canonical';

const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled']);
const PRIVATE_REASONING_PATTERN = /<think>[\s\S]*?<\/think>/gi;
const BEARER_PATTERN = /\bbearer\s+[a-z0-9._~+/-]+=*/gi;
const SECRET_VALUE_PATTERN =
  /\b(access[_-]?token|api[_-]?key|auth[_-]?token|authorization|cookie|id[_-]?token|password|refresh[_-]?token|session[_-]?token|token)\s*[:=]\s*(?!\[REDACTED\])([^\s,;]+)/gi;
const PRIVATE_REASONING_DETECTOR = /<think>[\s\S]*?<\/think>/i;
const BEARER_DETECTOR = /\bbearer\s+[a-z0-9._~+/-]+=*/i;
const SECRET_VALUE_DETECTOR =
  /\b(access[_-]?token|api[_-]?key|auth[_-]?token|authorization|cookie|id[_-]?token|password|refresh[_-]?token|session[_-]?token|token)\s*[:=]\s*(?!\[REDACTED\])([^\s,;]+)/i;
const MAX_ARTIFACT_BYTES = 1024 * 1024;
const REDACTED_VALUE = '[REDACTED]';

function withFinalizerIdentity<TPayload extends object>(
  payload: TPayload,
  idempotencyKey: string,
): TPayload & { originFinalizerKey: string } {
  return { ...payload, originFinalizerKey: idempotencyKey };
}

const STEP_PRIORITY: Record<ExecutionPriority, number> = {
  [ExecutionPriority.HIGH]: 100,
  [ExecutionPriority.NORMAL]: 0,
  [ExecutionPriority.BACKGROUND]: -100,
};

const FORBIDDEN_KEYS = new Set([
  'accesstoken',
  'apikey',
  'authtoken',
  'authorization',
  'chainofthought',
  'cookie',
  'credential',
  'idtoken',
  'password',
  'refreshtoken',
  'secret',
  'sessiontoken',
  'thoughts',
]);

export function redactExecutionText(value: string): string {
  return value
    .replace(PRIVATE_REASONING_PATTERN, '')
    .replace(BEARER_PATTERN, 'Bearer [REDACTED]')
    .replace(SECRET_VALUE_PATTERN, '$1=[REDACTED]');
}

function rejectForbiddenData(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      rejectForbiddenData(child, `${path}[${index}]`),
    );
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (FORBIDDEN_KEYS.has(normalized)) {
      if (child === REDACTED_VALUE) continue;
      throw new BadRequestException(
        `${path}.${key} is forbidden in execution data`,
      );
    }
    rejectForbiddenData(child, `${path}.${key}`);
  }
}

function rejectSensitiveStrings(value: unknown, path = '$'): void {
  if (typeof value === 'string') {
    if (
      PRIVATE_REASONING_DETECTOR.test(value) ||
      BEARER_DETECTOR.test(value) ||
      SECRET_VALUE_DETECTOR.test(value)
    ) {
      throw new BadRequestException(
        `${path} contains unredacted sensitive text`,
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      rejectSensitiveStrings(child, `${path}[${index}]`),
    );
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    rejectSensitiveStrings(child, `${path}.${key}`);
  }
}

export interface CreateExecutionOptions {
  rootExecutionId?: string;
  parentExecutionId?: string;
  childIdempotencyKey?: string;
  ownerPrincipal?: string;
  initialStep?: Omit<CreateExecutionStepInput, 'executionId'>;
  steps?: Array<Omit<CreateExecutionStepInput, 'executionId'>>;
  inputArtifacts?: Array<{
    role: string;
    kind: string;
    mediaType: string;
    body: Buffer;
    dataClassification?: string;
    retentionClass?: string;
  }>;
}

export interface CreateChildInferenceInput<
  TExecutionTaskType extends ExecutionTaskType,
  TWorkTaskType extends ExecutionTaskType,
> {
  taskType: TExecutionTaskType;
  payload: ExecutionTaskPayload<TExecutionTaskType>;
  work: ExecutionTaskWork<TWorkTaskType>;
  requiredCapability: string;
  deadline?: Date;
  causedByEventId: string;
}

const FINALIZER_IDEMPOTENCY_FIELD = 'originFinalizerKey';

export type ChatMessageEntity = AssistantMessageEntity | AgentMessageEntity;

export interface ChatExecutionAcceptance {
  execution: ExecutionEntity;
  userMessage: ChatMessageEntity;
}

export interface CancellationRequestView {
  rootExecutionId: string;
  status: ExecutionStatus;
  cancellationRequestedAt: string;
  cancellationReason: string;
}

type CreateSingleStepExecutionOptions = Omit<
  CreateExecutionOptions,
  'initialStep' | 'steps'
> & {
  finalizeOnFailure?: boolean;
};

@Injectable()
export class ExecutionService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ExecutionEntity)
    private readonly executionRepo: Repository<ExecutionEntity>,
    @InjectRepository(ExecutionEventEntity)
    private readonly eventRepo: Repository<ExecutionEventEntity>,
    @InjectRepository(ExecutionArtifactEntity)
    private readonly artifactRepo: Repository<ExecutionArtifactEntity>,
    private readonly config: ConfigService,
    private readonly contractValidator: ExecutionContractValidator,
    private readonly progress: ExecutionProgressService,
  ) {}

  resolveAccessScope(user: unknown): ExecutionAccessScope {
    const record =
      user && typeof user === 'object' ? (user as Record<string, unknown>) : {};
    const owner = record.userId ?? record.sub ?? 'standalone';
    return { ownerPrincipal: String(owner) };
  }

  private async finishConversationTurn(
    manager: EntityManager,
    execution: ExecutionEntity,
    status:
      | ConversationTurnStatus.COMPLETED
      | ConversationTurnStatus.FAILED
      | ConversationTurnStatus.CANCELLED,
    response?: { reply: string; error: string | null },
  ): Promise<ChatMessageEntity | null> {
    if (!['assistant-chat', 'agent-chat'].includes(execution.taskType)) {
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

  private chatPublication(
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

  async retireConversation(
    ownerType: ConversationOwnerType,
    ownerId: number,
  ): Promise<void> {
    const session = await this.dataSource
      .getRepository(ConversationSessionEntity)
      .findOneBy({ ownerType, ownerId });
    if (!session) return;
    const turns = await this.dataSource
      .getRepository(ConversationTurnEntity)
      .find({
        where: {
          sessionId: session.sessionId,
          status: In([
            ConversationTurnStatus.ACTIVE,
            ConversationTurnStatus.QUEUED,
          ]),
        },
        order: { createdAt: 'ASC' },
      });
    for (const turn of turns) {
      await this.updateStatus(
        turn.rootExecutionId,
        ExecutionStatus.CANCELLED,
        undefined,
        {
          cancellationReason: `${ownerType}_deleted`,
          completionReason: `${ownerType}_deleted`,
        },
      );
    }
  }

  async requestCancellation(
    rootExecutionId: string,
    scope: ExecutionAccessScope,
    reason?: string,
  ): Promise<CancellationRequestView> {
    const rawReason = String(reason ?? '').trim() || 'Cancelled by user';
    const cancellationReason = redactExecutionText(rawReason).slice(0, 500);
    const requested = await this.dataSource.transaction(async (manager) => {
      const executionRepo = manager.getRepository(ExecutionEntity);
      const root = await executionRepo.findOne({
        where: {
          executionId: rootExecutionId,
          rootExecutionId,
          ownerPrincipal: scope.ownerPrincipal,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!root) throw new NotFoundException('Execution not found');
      if (root.status === ExecutionStatus.CANCELLED) return root;
      if (
        [ExecutionStatus.COMPLETED, ExecutionStatus.FAILED].includes(
          root.status,
        )
      ) {
        throw new ConflictException('execution_terminal');
      }
      if (root.cancellationRequestedAt) return root;

      const executions = await executionRepo.find({
        where: { rootExecutionId },
        order: { createdAt: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      });
      const active = executions
        .filter((execution) => !TERMINAL_STATES.has(execution.status))
        .map((execution) =>
          execution.executionId === root.executionId ? root : execution,
        );
      const now = new Date();
      const eventRepo = manager.getRepository(ExecutionEventEntity);
      const rows = await eventRepo.find({
        where: { rootExecutionId },
        order: { sequence: 'ASC' },
      });
      let producerSequence = nextBackendProducerSequence(rows);
      let sequence = Number(root.lastSequence);
      let lastEventId = root.lastEventId;

      for (const execution of active) {
        const previousPhase = execution.phase;
        execution.cancellationRequestedAt = now;
        execution.cancellationReason = cancellationReason;
        execution.phase = 'cancellation_requested';
        execution.waitReason = null;
        execution.waitCondition = null;
        execution.resumePhase = null;
        execution.waitExpiresAt = null;
        const event = await this.appendBackendEvent(
          manager,
          root,
          producerSequence++,
          {
            eventType: 'execution.state_changed',
            payloadSchema: 'execution.state_changed/1',
            payload: {
              from: execution.status,
              to: execution.status,
              phase: 'cancellation_requested',
              reason: cancellationReason,
              previousPhase,
            },
            actor: { type: 'user', principal: scope.ownerPrincipal },
            executionId: execution.executionId,
            turnId: execution.turnId,
            causedByEventId: lastEventId,
            artifactRefs: [],
            redactionApplied: cancellationReason !== rawReason,
          },
          ++sequence,
        );
        execution.lastSequence = String(sequence);
        execution.lastEventId = event.eventId;
        lastEventId = event.eventId;
      }

      await manager.query(
        `
          UPDATE "execution_steps" step
          SET "status" = 'cancelled',
              "version" = "version" + 1,
              "updated_at" = $2
          FROM "executions" execution
          WHERE step."execution_id" = execution."execution_id"
            AND execution."root_execution_id" = $1
            AND step."status" IN ('blocked', 'ready')
        `,
        [rootExecutionId, now],
      );
      await manager.query(
        `
          UPDATE "execution_operations" operation
          SET "status" = 'cancelled',
              "finished_at" = $2,
              "updated_at" = $2
          FROM "execution_steps" step, "executions" execution
          WHERE operation."step_id" = step."step_id"
            AND step."execution_id" = execution."execution_id"
            AND execution."root_execution_id" = $1
            AND step."status" = 'cancelled'
            AND operation."status" IN ('planned', 'prepared')
        `,
        [rootExecutionId, now],
      );
      await manager.query(
        `
          UPDATE "execution_confirmations" confirmation
          SET "status" = 'denied',
              "decided_by" = $2,
              "decided_at" = $3,
              "updated_at" = $3
          FROM "executions" execution
          WHERE confirmation."execution_id" = execution."execution_id"
            AND execution."root_execution_id" = $1
            AND confirmation."status" = 'pending'
        `,
        [rootExecutionId, scope.ownerPrincipal, now],
      );

      root.lastSequence = String(sequence);
      root.lastEventId = lastEventId;
      await executionRepo.save(active);
      const publicationEventId = lastEventId;
      if (publicationEventId) {
        const outboxRepo = manager.getRepository(ExecutionOutboxEntity);
        await outboxRepo.save(
          outboxRepo.create({
            outboxId: randomUUID(),
            executionId: rootExecutionId,
            eventId: publicationEventId,
            schemaVersion: 'execution-outbox/1',
            socketEvent: 'executionCancellationRequested',
            payload: {
              rootExecutionId,
              taskType: root.taskType,
              ownerId: executionPayloadOwnerId(root.payload) ?? null,
              cancellationReason,
              cancellationRequestedAt: now.toISOString(),
            },
            status: ExecutionOutboxStatus.PENDING,
            attempts: 0,
            availableAt: now,
            leaseExpiresAt: null,
            publishedAt: null,
            lastError: null,
          }),
        );
      }
      return root;
    });

    await this.reconcileRequestedCancellations(100);
    const current = await this.executionRepo.findOneByOrFail({
      executionId: requested.executionId,
    });
    return {
      rootExecutionId,
      status: current.status,
      cancellationRequestedAt: (
        current.cancellationRequestedAt ??
        current.completedAt ??
        new Date()
      ).toISOString(),
      cancellationReason: current.cancellationReason ?? cancellationReason,
    };
  }

  async reconcileRequestedCancellations(limit = 20): Promise<number> {
    let reconciled = 0;
    while (reconciled < limit) {
      const rows = await this.dataSource.query(
        `
          SELECT execution."execution_id"
          FROM "executions" execution
          WHERE execution."cancellation_requested_at" IS NOT NULL
            AND execution."status" NOT IN ('completed', 'failed', 'cancelled')
            AND NOT EXISTS (
              SELECT 1
              FROM "execution_steps" step
              WHERE step."execution_id" = execution."execution_id"
                AND step."status" IN ('blocked', 'ready', 'running', 'result_received')
            )
            AND NOT EXISTS (
              SELECT 1
              FROM "executions" child
              WHERE child."parent_execution_id" = execution."execution_id"
                AND child."status" NOT IN ('completed', 'failed', 'cancelled')
            )
          ORDER BY execution."created_at" DESC
          LIMIT 1
        `,
      );
      if (!rows.length) break;
      const execution = await this.executionRepo.findOneBy({
        executionId: String(rows[0].execution_id),
      });
      if (!execution) continue;
      await this.updateStatus(
        execution.executionId,
        ExecutionStatus.CANCELLED,
        undefined,
        {
          completionReason: 'user_cancelled',
          cancellationReason:
            execution.cancellationReason ?? 'Cancelled by user',
        },
      );
      reconciled += 1;
    }
    return reconciled;
  }

  async createChildInference<
    TExecutionTaskType extends ExecutionTaskType,
    TWorkTaskType extends ExecutionTaskType,
  >(
    manager: EntityManager,
    parent: ExecutionEntity,
    input: CreateChildInferenceInput<TExecutionTaskType, TWorkTaskType>,
  ): Promise<{ execution: ExecutionEntity; step: ExecutionStepEntity }> {
    const executionRepo = manager.getRepository(ExecutionEntity);
    const root =
      parent.executionId === parent.rootExecutionId
        ? parent
        : await executionRepo.findOne({
            where: {
              executionId: parent.rootExecutionId,
              rootExecutionId: parent.rootExecutionId,
            },
            lock: { mode: 'pessimistic_write' },
          });
    if (!root) throw new NotFoundException('Root execution not found');
    if (root.cancellationRequestedAt || parent.cancellationRequestedAt) {
      throw new ConflictException('execution_cancellation_requested');
    }
    const cause = await manager.getRepository(ExecutionEventEntity).findOneBy({
      eventId: input.causedByEventId,
      rootExecutionId: root.rootExecutionId,
    });
    if (!cause) throw new BadRequestException('Invalid child execution cause');

    const executionId = randomUUID();
    const child = executionRepo.create({
      executionId,
      rootExecutionId: root.rootExecutionId,
      parentExecutionId: parent.executionId,
      sessionId: parent.sessionId,
      turnId: parent.turnId,
      ownerPrincipal: parent.ownerPrincipal,
      schemaVersion: EXECUTION_SCHEMA,
      taskType: input.taskType,
      payload: input.payload,
      status: ExecutionStatus.QUEUED,
      phase: null,
      waitReason: null,
      waitCondition: null,
      resumePhase: null,
      waitExpiresAt: null,
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
    await executionRepo.save(child);
    const rows = await manager.getRepository(ExecutionEventEntity).find({
      where: { rootExecutionId: root.rootExecutionId },
      order: { sequence: 'ASC' },
    });
    const event = await this.appendBackendEvent(
      manager,
      root,
      nextBackendProducerSequence(rows),
      {
        eventType: 'execution.created',
        payloadSchema: 'execution.created/1',
        payload: {
          executionKind: input.taskType,
          initialStatus: ExecutionStatus.QUEUED,
        },
        actor: { type: 'system' },
        executionId,
        turnId: child.turnId,
        causedByEventId: input.causedByEventId,
      },
      Number(root.lastSequence) + 1,
    );
    child.lastSequence = event.sequence;
    child.lastEventId = event.eventId;
    root.lastSequence = event.sequence;
    root.lastEventId = event.eventId;
    await executionRepo.save(root);
    await executionRepo.save(child);
    const childPayload =
      input.work.payload && typeof input.work.payload === 'object'
        ? (input.work.payload as Record<string, unknown>)
        : {};
    const contextArtifact = await freezeActiveContextArtifact(manager, {
      rootExecutionId: child.rootExecutionId,
      sessionId: child.sessionId,
      turnId: child.turnId,
      causedByEventId: event.eventId,
      effectivePayload: childPayload,
    });
    const step = await createExecutionStep(manager, {
      executionId,
      stepKind: ExecutionStepKind.INFERENCE,
      inputArtifactRefs: [
        {
          role: ACTIVE_CONTEXT_ARTIFACT_ROLE,
          artifactId: contextArtifact.artifactId,
        },
      ],
      work: input.work,
      requiredCapabilities: [input.requiredCapability],
      deadline: input.deadline,
      causedByEventId: event.eventId,
    });
    return { execution: child, step };
  }

  async createChildInferenceOnce<
    TExecutionTaskType extends ExecutionTaskType,
    TWorkTaskType extends ExecutionTaskType,
  >(
    parentExecutionId: string,
    idempotencyKey: string,
    input: CreateChildInferenceInput<TExecutionTaskType, TWorkTaskType>,
  ): Promise<{ execution: ExecutionEntity; step: ExecutionStepEntity }> {
    if (!idempotencyKey || idempotencyKey.length > 160) {
      throw new BadRequestException('invalid_child_idempotency_key');
    }
    return this.dataSource.transaction(async (manager) => {
      const executions = manager.getRepository(ExecutionEntity);
      const parentRef = await executions.findOneBy({
        executionId: parentExecutionId,
      });
      if (!parentRef) throw new NotFoundException('Parent execution not found');
      const root = await executions.findOne({
        where: {
          executionId: parentRef.rootExecutionId,
          rootExecutionId: parentRef.rootExecutionId,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!root) throw new NotFoundException('Root execution not found');
      const parent =
        parentRef.executionId === root.executionId
          ? root
          : await executions.findOne({
              where: {
                executionId: parentRef.executionId,
                rootExecutionId: root.executionId,
              },
              lock: { mode: 'pessimistic_write' },
            });
      if (!parent) throw new NotFoundException('Parent execution not found');
      if (root.cancellationRequestedAt || parent.cancellationRequestedAt) {
        throw new ConflictException('execution_cancellation_requested');
      }

      const payload = withFinalizerIdentity(input.payload, idempotencyKey);
      const workPayload = withFinalizerIdentity(
        input.work.payload,
        idempotencyKey,
      );
      const work = { ...input.work, payload: workPayload };
      const candidates = await executions.find({
        where: { parentExecutionId, taskType: input.taskType },
      });
      const matches = candidates.filter(
        (candidate) =>
          candidate.payload?.[FINALIZER_IDEMPOTENCY_FIELD] === idempotencyKey,
      );
      if (matches.length > 1) {
        throw new ConflictException('duplicate_child_idempotency_key');
      }
      if (matches.length === 1) {
        const existing = matches[0];
        if (canonicalHash(existing.payload) !== canonicalHash(payload)) {
          throw new ConflictException('child_idempotency_conflict');
        }
        const step = await manager.getRepository(ExecutionStepEntity).findOne({
          where: {
            executionId: existing.executionId,
            stepKind: ExecutionStepKind.INFERENCE,
          },
        });
        if (!step) throw new ConflictException('incomplete_child_execution');
        return { execution: existing, step };
      }

      return this.createChildInference(manager, parent, {
        ...input,
        payload,
        work,
      });
    });
  }

  async createForChat<TExecutionKind extends keyof ChatCreationPayloadByKind>(
    executionKind: TExecutionKind,
    message: string,
    scope: ExecutionAccessScope,
    payload: ChatCreationPayloadByKind[TExecutionKind],
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
      const requestArtifact = await manager.save(
        manager.getRepository(ExecutionArtifactEntity).create({
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
          storageRef: `execution:${rootExecutionId}:artifact:${artifactId}`,
          body,
        }),
      );
      const createdEvent = await this.appendBackendEvent(
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
      const messageEvent = await this.appendBackendEvent(
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
      const sourceEvent = await this.appendBackendEvent(
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
      return { execution: await manager.save(execution), userMessage };
    });
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
    if (!['assistant-chat', 'agent-chat'].includes(execution.taskType)) {
      throw new ConflictException('invalid_chat_execution_type');
    }
    const taskType =
      execution.taskType === 'assistant-chat' ? 'assistant-chat' : 'agent-chat';
    const effectivePayload = execution.payload as ChatExecutionPayload;
    const workflow = await buildContextInputWorkflow(manager, {
      executionId: execution.executionId,
      taskType,
      message,
      requestArtifact,
      effectivePayload,
      causedByEventId,
    });
    if (workflow) {
      for (const step of workflow.steps) {
        await createExecutionStep(manager, {
          ...step,
          executionId: execution.executionId,
        });
      }
      return;
    }

    const contextArtifact = await freezeActiveContextArtifact(manager, {
      rootExecutionId: execution.rootExecutionId,
      sessionId: execution.sessionId,
      turnId: execution.turnId,
      causedByEventId,
      effectivePayload,
      derivedFromArtifactIds: [requestArtifact.artifactId],
    });
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
      priority: STEP_PRIORITY[ExecutionPriority.HIGH],
      causedByEventId,
    });
  }

  private browserFederationEnabled(): boolean {
    return this.config.get('FEATURE_BROWSER_FEDERATION') === 'true';
  }

  async create<TTaskType extends ExecutionTaskType>(
    taskType: TTaskType,
    priority: ExecutionPriority,
    payload: ExecutionTaskPayload<TTaskType>,
    options?: CreateExecutionOptions,
  ): Promise<ExecutionEntity> {
    const executionId = randomUUID();
    const rootExecutionId = options?.rootExecutionId ?? executionId;
    return this.dataSource.transaction(async (manager) => {
      const executionRepo = manager.getRepository(ExecutionEntity);
      let eventRoot: ExecutionEntity | null = null;
      let parent: ExecutionEntity | null = null;
      if (rootExecutionId !== executionId) {
        if (!options?.parentExecutionId) {
          throw new BadRequestException('Child execution requires a parent');
        }
        eventRoot = await executionRepo.findOne({
          where: { executionId: rootExecutionId, rootExecutionId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!eventRoot) throw new NotFoundException('Root execution not found');
        if (eventRoot.cancellationRequestedAt) {
          throw new ConflictException('execution_cancellation_requested');
        }
        parent = await executionRepo.findOne({
          where: {
            executionId: options.parentExecutionId,
            rootExecutionId,
          },
        });
        if (!parent) throw new NotFoundException('Parent execution not found');
        if (parent.cancellationRequestedAt) {
          throw new ConflictException('execution_cancellation_requested');
        }
        if (
          options.ownerPrincipal &&
          options.ownerPrincipal !== eventRoot.ownerPrincipal
        ) {
          throw new BadRequestException('Child execution scope mismatch');
        }
      } else if (options?.parentExecutionId) {
        throw new BadRequestException('Root execution cannot have a parent');
      }
      let effectivePayload = payload;
      if (options?.childIdempotencyKey !== undefined) {
        if (
          !parent ||
          !options.childIdempotencyKey ||
          options.childIdempotencyKey.length > 160
        ) {
          throw new BadRequestException('invalid_child_idempotency_key');
        }
        effectivePayload = {
          ...payload,
          [FINALIZER_IDEMPOTENCY_FIELD]: options.childIdempotencyKey,
        };
        const candidates = await executionRepo.find({
          where: { parentExecutionId: parent.executionId, taskType },
        });
        const matches = candidates.filter(
          (candidate) =>
            candidate.payload?.[FINALIZER_IDEMPOTENCY_FIELD] ===
            options.childIdempotencyKey,
        );
        if (matches.length > 1) {
          throw new ConflictException('duplicate_child_idempotency_key');
        }
        if (matches.length === 1) {
          const existing = matches[0];
          if (
            canonicalHash(existing.payload) !== canonicalHash(effectivePayload)
          ) {
            throw new ConflictException('child_idempotency_conflict');
          }
          const stepCount = await manager
            .getRepository(ExecutionStepEntity)
            .countBy({ executionId: existing.executionId });
          const expectedStepCount = options.steps?.length ?? 1;
          if (stepCount !== expectedStepCount) {
            throw new ConflictException('incomplete_child_execution');
          }
          return existing;
        }
      }
      const execution = executionRepo.create({
        executionId,
        rootExecutionId,
        parentExecutionId: options?.parentExecutionId ?? null,
        sessionId: parent?.sessionId ?? null,
        turnId: parent?.turnId ?? null,
        ownerPrincipal:
          eventRoot?.ownerPrincipal ?? options?.ownerPrincipal ?? 'system',
        schemaVersion: EXECUTION_SCHEMA,
        taskType,
        payload: effectivePayload,
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
      await executionRepo.save(execution);
      const inputArtifactRefs = await Promise.all(
        (options?.inputArtifacts ?? []).map(async (input) => {
          const artifactId = randomUUID();
          await manager.save(
            manager.getRepository(ExecutionArtifactEntity).create({
              artifactId,
              rootExecutionId,
              kind: input.kind,
              contentHash: contentHash(input.body),
              size: String(input.body.length),
              mediaType: input.mediaType,
              encoding: 'identity',
              dataClassification: input.dataClassification ?? 'workspace',
              redaction: { applied: false },
              retentionClass: input.retentionClass ?? 'execution',
              createdByEventId: null,
              inputSourceIds: [],
              storageRef: `execution:${rootExecutionId}:artifact:${artifactId}`,
              body: input.body,
            }),
          );
          return { role: input.role, artifactId };
        }),
      );
      if (options?.steps && !options.steps.length) {
        throw new BadRequestException('Execution requires at least one step');
      }
      const rootEvents = eventRoot
        ? await manager.getRepository(ExecutionEventEntity).find({
            where: { rootExecutionId },
            order: { sequence: 'ASC' },
          })
        : [];
      const eventSequence = eventRoot ? Number(eventRoot.lastSequence) + 1 : 1;
      const producerSequence = eventRoot
        ? nextBackendProducerSequence(rootEvents)
        : 1;
      const executionEvent = await this.appendBackendEvent(
        manager,
        eventRoot ?? execution,
        producerSequence,
        {
          eventType: 'execution.created',
          payloadSchema: 'execution.created/1',
          payload: { executionKind: taskType, initialStatus: 'queued' },
          actor: { type: 'system' },
          executionId,
          causedByEventId: parent?.lastEventId ?? undefined,
          artifactRefs: inputArtifactRefs.map(({ artifactId }) => artifactId),
        },
        eventSequence,
      );
      execution.lastSequence = executionEvent.sequence;
      execution.lastEventId = executionEvent.eventId;
      if (eventRoot) {
        eventRoot.lastSequence = executionEvent.sequence;
        eventRoot.lastEventId = executionEvent.eventId;
        await executionRepo.save(eventRoot);
      }
      const steps = options?.steps ?? [
        {
          stepKind: ExecutionStepKind.SERVICE,
          work: executionTaskWork(taskType, effectivePayload),
          requiredCapabilities: [taskType],
          priority: STEP_PRIORITY[priority],
          ...options?.initialStep,
        },
      ];
      for (const [index, step] of steps.entries()) {
        await createExecutionStep(manager, {
          ...step,
          inputArtifactRefs: [
            ...(index === 0 ? inputArtifactRefs : []),
            ...(step.inputArtifactRefs ?? []),
          ],
          executionId,
          causedByEventId: step.causedByEventId ?? executionEvent.eventId,
        });
      }
      return executionRepo.save(execution);
    });
  }

  async createInference<TTaskType extends ExecutionTaskType>(
    taskType: TTaskType,
    priority: ExecutionPriority,
    payload: ExecutionTaskPayload<TTaskType>,
    options?: CreateSingleStepExecutionOptions,
  ): Promise<ExecutionEntity> {
    const { finalizeOnFailure = false, ...executionOptions } = options ?? {};
    return this.create(taskType, priority, payload, {
      ...executionOptions,
      initialStep: {
        stepKind: ExecutionStepKind.INFERENCE,
        work: executionTaskWork(taskType, payload),
        finalizeOnFailure,
        requiredCapabilities: [taskType],
        priority: STEP_PRIORITY[priority],
      },
    });
  }

  async createCode<TTaskType extends ExecutionTaskType>(
    taskType: TTaskType,
    priority: ExecutionPriority,
    payload: ExecutionTaskPayload<TTaskType>,
    options?: CreateSingleStepExecutionOptions,
  ): Promise<ExecutionEntity> {
    const { finalizeOnFailure = false, ...executionOptions } = options ?? {};
    return this.create(taskType, priority, payload, {
      ...executionOptions,
      initialStep: {
        stepKind: ExecutionStepKind.CODE,
        work: executionTaskWork(taskType, payload),
        finalizeOnFailure,
        requiredCapabilities: [taskType],
        priority: STEP_PRIORITY[priority],
      },
    });
  }

  async findAll(): Promise<ExecutionEntity[]> {
    return this.executionRepo.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(executionId: string): Promise<ExecutionEntity | null> {
    return this.executionRepo.findOneBy({ executionId });
  }

  async claimReadyForFinalization(): Promise<ExecutionEntity | null> {
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager.query(`
        SELECT "execution_id"
        FROM "executions"
        WHERE "status" = 'running'
          AND "phase" IN ('backend_finalization', 'backend_failure_finalization')
        ORDER BY "updated_at"
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `);
      if (!rows.length) return null;

      const executionRepo = manager.getRepository(ExecutionEntity);
      const execution = await executionRepo.findOneBy({
        executionId: rows[0].execution_id,
      });
      if (!execution) return null;

      execution.phase =
        execution.phase === 'backend_failure_finalization'
          ? 'domain_failure_finalization'
          : 'domain_finalization';
      return executionRepo.save(execution);
    });
  }

  async recoverStaleFinalizations(staleBefore: Date): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const [rows] = (await manager.query(
        `
          UPDATE "executions"
          SET "phase" = CASE
            WHEN "phase" = 'domain_failure_finalization'
              THEN 'backend_failure_finalization'
            ELSE 'backend_finalization'
          END,
          "updated_at" = now()
          WHERE "status" = 'running'
            AND "phase" IN ('domain_finalization', 'domain_failure_finalization')
            AND "updated_at" <= $1
          RETURNING "execution_id"
        `,
        [staleBefore],
      )) as [{ execution_id: string }[], number];
      return rows.length;
    });
  }

  async finalizePendingTerminals(limit = 20): Promise<number> {
    const pending = await this.executionRepo.find({
      where: {
        status: ExecutionStatus.RUNNING,
        phase: In(['terminal_pending_failed', 'terminal_pending_cancelled']),
      },
      order: { updatedAt: 'ASC' },
      take: limit,
    });
    let finalized = 0;
    for (const execution of pending) {
      const cancelled = execution.phase === 'terminal_pending_cancelled';
      const status = cancelled
        ? ExecutionStatus.CANCELLED
        : ExecutionStatus.FAILED;
      const error = execution.error as Record<string, unknown> | null;
      await this.updateStatus(
        execution.executionId,
        status,
        typeof error?.message === 'string' ? error.message : undefined,
        {
          completionReason: cancelled ? 'worker_cancelled' : 'worker_failed',
        },
      );
      finalized += 1;
    }
    return finalized;
  }

  async updateStatus(
    executionId: string,
    status: ExecutionStatus,
    failureMessage?: string,
    options?: {
      completionKind?: string;
      completionReason?: string;
      cancellationReason?: string;
      publication?: ExecutionPublication;
    },
  ): Promise<ExecutionEntity | null> {
    return this.dataSource.transaction(async (manager) => {
      const executionRepo = manager.getRepository(ExecutionEntity);
      const eventRepo = manager.getRepository(ExecutionEventEntity);
      const execution = await executionRepo.findOne({
        where: { executionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!execution) return null;
      if (execution.status === status) return execution;

      const root =
        execution.rootExecutionId === execution.executionId
          ? execution
          : await executionRepo.findOne({
              where: {
                executionId: execution.rootExecutionId,
                rootExecutionId: execution.rootExecutionId,
              },
              lock: { mode: 'pessimistic_write' },
            });
      if (!root) throw new NotFoundException('Root execution not found');

      const previousStatus = execution.status;
      if (status === ExecutionStatus.WAITING) {
        throw new ConflictException('waiting_requires_durable_condition');
      }
      execution.status = status;
      execution.waitReason = null;
      execution.waitCondition = null;
      execution.resumePhase = null;
      execution.waitExpiresAt = null;
      if (status === ExecutionStatus.QUEUED) {
        execution.phase = null;
      }
      if (TERMINAL_STATES.has(status)) {
        execution.completedAt = new Date();
        execution.phase = null;
        execution.completionKind = options?.completionKind ?? 'full';
        execution.completionReason =
          options?.completionReason ??
          (status === ExecutionStatus.FAILED
            ? 'processor_failed'
            : status === ExecutionStatus.CANCELLED
              ? 'cancelled'
              : 'backend_finalized');
        if (status === ExecutionStatus.FAILED && !execution.error) {
          execution.error = {
            code: 'EXECUTION_FAILED',
            message: redactExecutionText(failureMessage ?? 'Execution failed'),
          };
        }
        if (status === ExecutionStatus.CANCELLED) {
          execution.cancellationRequestedAt ??= new Date();
          execution.cancellationReason = redactExecutionText(
            options?.cancellationReason ??
              execution.cancellationReason ??
              'Cancelled',
          ).slice(0, 500);
          execution.error = null;
        }
      }

      if (TERMINAL_STATES.has(status)) {
        await finishSkillActivations(manager, execution.executionId, status);
        await this.finishConversationTurn(
          manager,
          execution,
          status === ExecutionStatus.COMPLETED
            ? ConversationTurnStatus.COMPLETED
            : status === ExecutionStatus.CANCELLED
              ? ConversationTurnStatus.CANCELLED
              : ConversationTurnStatus.FAILED,
        );
      }

      const lastProducerEvent = await eventRepo.findOne({
        where: {
          rootExecutionId: root.rootExecutionId,
          producerComponent: 'documents-backend',
        },
        order: { producerSequence: 'DESC' },
      });
      const producerSequence =
        Number(lastProducerEvent?.producerSequence ?? 0) + 1;
      const stateEvent = await this.appendBackendEvent(
        manager,
        root,
        producerSequence,
        {
          eventType: 'execution.state_changed',
          payloadSchema: 'execution.state_changed/1',
          payload: {
            from: previousStatus,
            to: status,
            completionKind: TERMINAL_STATES.has(status)
              ? execution.completionKind
              : undefined,
            completionReason: TERMINAL_STATES.has(status)
              ? execution.completionReason
              : undefined,
            result: TERMINAL_STATES.has(status) ? execution.result : undefined,
            error: TERMINAL_STATES.has(status) ? execution.error : undefined,
            reason:
              status === ExecutionStatus.CANCELLED
                ? execution.cancellationReason
                : undefined,
          },
          actor: { type: 'system' },
          executionId: execution.executionId,
          turnId: execution.turnId,
          causedByEventId: root.lastEventId,
          artifactRefs: [],
        },
      );
      root.lastSequence = stateEvent.sequence;
      root.lastEventId = stateEvent.eventId;
      await executionRepo.save(execution);
      if (root.executionId !== execution.executionId) {
        await executionRepo.save(root);
      }
      if (TERMINAL_STATES.has(status)) {
        await this.appendTerminalPublication(
          manager,
          execution,
          stateEvent.eventId,
          options?.publication,
        );
      }
      return execution;
    });
  }

  async markAsCompleted(
    executionId: string,
    options?: {
      completionKind?: string;
      completionReason?: string;
      publication?: ExecutionPublication;
    },
  ): Promise<ExecutionEntity | null> {
    return this.updateStatus(
      executionId,
      ExecutionStatus.COMPLETED,
      undefined,
      options,
    );
  }

  async markAsFailed(
    executionId: string,
    failureMessage?: string,
    options?: {
      completionKind?: string;
      completionReason?: string;
      publication?: ExecutionPublication;
    },
  ): Promise<ExecutionEntity | null> {
    return this.updateStatus(
      executionId,
      ExecutionStatus.FAILED,
      failureMessage,
      options,
    );
  }

  private async appendTerminalPublication(
    manager: EntityManager,
    execution: ExecutionEntity,
    eventId: string,
    publication?: ExecutionPublication,
  ): Promise<void> {
    const resolved = publication ?? {
      socketEvent: 'notification',
      payload: {
        type: execution.taskType,
        message: `Execution ${execution.status}: ${execution.taskType}`,
        executionId: execution.executionId,
        status: execution.status,
      },
    };
    const outboxRepo = manager.getRepository(ExecutionOutboxEntity);
    await outboxRepo.save(
      outboxRepo.create({
        outboxId: randomUUID(),
        executionId: execution.executionId,
        eventId,
        schemaVersion: 'execution-outbox/1',
        socketEvent: resolved.socketEvent,
        payload: resolved.payload,
        status: ExecutionOutboxStatus.PENDING,
        attempts: 0,
        availableAt: new Date(),
        leaseExpiresAt: null,
        publishedAt: null,
        lastError: null,
      }),
    );
  }

  async acceptArtifacts(
    rootExecutionId: string,
    artifacts: IncomingExecutionArtifact[],
  ): Promise<{ accepted: number; duplicates: number }> {
    if (!Array.isArray(artifacts) || artifacts.length > 100) {
      throw new BadRequestException(
        'artifacts must be an array of at most 100 items',
      );
    }
    return this.dataSource.transaction(async (manager) => {
      const execution = await manager.getRepository(ExecutionEntity).findOne({
        where: { executionId: rootExecutionId, rootExecutionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!execution) throw new NotFoundException('Execution not found');
      let accepted = 0;
      let duplicates = 0;
      for (const input of artifacts) {
        this.validateArtifact(input);
        const repo = manager.getRepository(ExecutionArtifactEntity);
        const existing = await repo.findOne({
          where: { artifactId: input.artifactId },
        });
        if (existing) {
          if (
            existing.rootExecutionId !== rootExecutionId ||
            existing.contentHash !== input.contentHash
          ) {
            throw new ConflictException(
              `Artifact identity conflict: ${input.artifactId}`,
            );
          }
          duplicates += 1;
          continue;
        }
        const body =
          input.bodyBase64 !== undefined
            ? Buffer.from(input.bodyBase64, 'base64')
            : null;
        if (body !== null && body.toString('base64') !== input.bodyBase64) {
          throw new BadRequestException(
            `Artifact body is not canonical base64: ${input.artifactId}`,
          );
        }
        if (
          body !== null &&
          (body.length !== input.size ||
            contentHash(body) !== input.contentHash)
        ) {
          throw new BadRequestException(
            `Artifact integrity mismatch: ${input.artifactId}`,
          );
        }
        if (body !== null) this.rejectSensitiveArtifactBody(input, body);
        await repo.save(
          repo.create({
            artifactId: input.artifactId,
            rootExecutionId,
            kind: input.kind,
            contentHash: input.contentHash,
            size: String(input.size),
            mediaType: input.mediaType,
            encoding: input.encoding ?? 'identity',
            dataClassification: input.dataClassification,
            redaction: input.redaction ?? { applied: false },
            retentionClass: input.retentionClass ?? 'evaluation',
            createdByEventId: input.createdByEventId ?? null,
            inputSourceIds: input.inputSourceIds ?? [],
            storageRef: `execution:${rootExecutionId}:artifact:${input.artifactId}`,
            body,
          }),
        );
        if (!body)
          this.addMissing(execution, `artifact_body:${input.artifactId}`);
        accepted += 1;
      }
      await manager.save(execution);
      return { accepted, duplicates };
    });
  }

  async acceptEvents(
    rootExecutionId: string,
    events: Record<string, unknown>[],
  ): Promise<{ accepted: number; duplicates: number; lastSequence: number }> {
    if (!Array.isArray(events) || events.length === 0 || events.length > 200) {
      throw new BadRequestException(
        'events must contain between 1 and 200 items',
      );
    }
    return this.dataSource.transaction(async (manager) => {
      const executionRepo = manager.getRepository(ExecutionEntity);
      const eventRepo = manager.getRepository(ExecutionEventEntity);
      const execution = await executionRepo.findOne({
        where: { executionId: rootExecutionId, rootExecutionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!execution) throw new NotFoundException('Execution not found');
      let sequence = Number(execution.lastSequence);
      let accepted = 0;
      let duplicates = 0;
      for (const incoming of events) {
        this.validateIncomingEvent(execution, incoming);
        const targetExecution =
          incoming.executionId === execution.executionId
            ? execution
            : await executionRepo.findOne({
                where: {
                  executionId: String(incoming.executionId),
                  rootExecutionId,
                },
                lock: { mode: 'pessimistic_write' },
              });
        if (!targetExecution) {
          throw new BadRequestException(
            `Unknown execution in root: ${String(incoming.executionId)}`,
          );
        }
        const eventId = String(incoming.eventId);
        const duplicate = await eventRepo.findOne({ where: { eventId } });
        if (duplicate) {
          if (duplicate.rootExecutionId !== rootExecutionId) {
            throw new ConflictException(`Event identity conflict: ${eventId}`);
          }
          duplicates += 1;
          continue;
        }
        if (TERMINAL_STATES.has(execution.status)) {
          throw new ConflictException(
            'A terminal execution cannot accept new events',
          );
        }
        const producer = incoming.producer as Record<string, unknown>;
        const producerSequence = Number(incoming.producerSequence);
        const occupied = await eventRepo.findOne({
          where: {
            rootExecutionId,
            producerComponent: String(producer.component),
            producerInstanceId: String(producer.instanceId),
            producerSequence: String(producerSequence),
          },
        });
        if (occupied) {
          throw new ConflictException(
            `Producer sequence already belongs to ${occupied.eventId}`,
          );
        }
        const previousProducerEvent = await eventRepo.findOne({
          where: {
            rootExecutionId,
            producerComponent: String(producer.component),
            producerInstanceId: String(producer.instanceId),
          },
          order: { producerSequence: 'DESC' },
        });
        if (
          previousProducerEvent &&
          producerSequence <= Number(previousProducerEvent.producerSequence)
        ) {
          throw new ConflictException(
            'producerSequence must be strictly monotonic',
          );
        }
        const cause = incoming.causedByEventId;
        if (cause) {
          const knownCause = await eventRepo.findOne({
            where: { eventId: String(cause) },
          });
          if (!knownCause || knownCause.rootExecutionId !== rootExecutionId) {
            throw new BadRequestException(`Unknown causal event: ${cause}`);
          }
        }
        for (const artifactId of incoming.artifactRefs as string[]) {
          const artifact = await manager
            .getRepository(ExecutionArtifactEntity)
            .findOne({
              where: { artifactId },
            });
          if (!artifact || artifact.rootExecutionId !== rootExecutionId) {
            throw new BadRequestException(
              `Unknown artifact reference: ${artifactId}`,
            );
          }
        }
        await this.validateOperationLifecycle(
          eventRepo,
          rootExecutionId,
          incoming,
        );
        await this.progress.validateOperationStart(
          eventRepo,
          targetExecution,
          incoming,
        );
        this.validateStateTransition(targetExecution, incoming);
        sequence += 1;
        const ingestedAt = new Date().toISOString();
        const envelope: Record<string, unknown> = {
          ...incoming,
          sequence,
          ingestedAt,
          schemaVersion: EXECUTION_EVENT_SCHEMA,
        };
        delete envelope.contentHash;
        const withHash = { ...envelope, contentHash: canonicalHash(envelope) };
        const row = eventRepo.create({
          eventId,
          rootExecutionId,
          sequence: String(sequence),
          producerComponent: String(producer.component),
          producerInstanceId: String(producer.instanceId),
          producerSequence: String(producerSequence),
          eventType: String(incoming.eventType),
          executionId: String(incoming.executionId),
          operationId: incoming.operationId
            ? String(incoming.operationId)
            : null,
          attemptId: incoming.attemptId ? String(incoming.attemptId) : null,
          causedByEventId: cause ? String(cause) : null,
          occurredAt: new Date(String(incoming.occurredAt)),
          ingestedAt: new Date(ingestedAt),
          contentHash: withHash.contentHash,
          envelope: withHash,
        });
        await eventRepo.save(row);
        this.materializeState(targetExecution, incoming);
        if (targetExecution.executionId !== execution.executionId) {
          await executionRepo.save(targetExecution);
        }
        execution.lastEventId = eventId;
        accepted += 1;
      }
      execution.lastSequence = String(sequence);
      await this.progress.refreshProjection(eventRepo, execution);
      await executionRepo.save(execution);
      return { accepted, duplicates, lastSequence: sequence };
    });
  }

  async completeExecution(
    executionId: string,
    reply: string,
    error: string | null,
    completion?: ExecutionCompletion,
    publication?: ExecutionPublication,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const executionRepo = manager.getRepository(ExecutionEntity);
      const eventRepo = manager.getRepository(ExecutionEventEntity);
      const execution = await executionRepo.findOne({
        where: { executionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!execution) return;
      const root =
        execution.executionId === execution.rootExecutionId
          ? execution
          : await executionRepo.findOne({
              where: {
                executionId: execution.rootExecutionId,
                rootExecutionId: execution.rootExecutionId,
              },
              lock: { mode: 'pessimistic_write' },
            });
      if (!root) throw new NotFoundException('Root execution not found');
      const rows = await eventRepo.find({
        where: { rootExecutionId: execution.rootExecutionId },
        order: { sequence: 'ASC' },
      });
      const artifacts =
        completion?.source === 'runtime_template'
          ? await this.loadArtifactsWithBody(
              manager.getRepository(ExecutionArtifactEntity),
              execution.rootExecutionId,
            )
          : [];
      this.assertLoopDetectedCompletion(execution, rows, error, completion);
      this.assertDeterministicPartial(
        execution,
        rows,
        artifacts,
        reply,
        error,
        completion,
      );
      const conversationMessage = await this.finishConversationTurn(
        manager,
        execution,
        error
          ? ConversationTurnStatus.FAILED
          : ConversationTurnStatus.COMPLETED,
        { reply: redactExecutionText(reply), error },
      );
      const resolvedPublication =
        publication ?? this.chatPublication(execution, conversationMessage);
      let lastEventId = execution.lastEventId ?? root.lastEventId;
      let terminalEventId: string | null = null;
      let sequence = Number(root.lastSequence);
      const producerSequence = Math.max(
        2,
        ...rows
          .filter((row) => row.producerComponent === 'documents-backend')
          .map((row) => Number(row.producerSequence)),
      );
      let nextProducerSequence = producerSequence;
      const hasFinalMessage = rows.some((row) => {
        const payload = row.envelope.payload as
          Record<string, unknown> | undefined;
        return (
          row.executionId === execution.executionId &&
          row.eventType === 'message.recorded' &&
          payload?.messageKind === 'final_response'
        );
      });
      const observedSourceIds = rows.flatMap((row) => {
        if (row.eventType !== 'source.observed') return [];
        const sourceId = (row.envelope.payload as Record<string, unknown>)
          ?.sourceId;
        return typeof sourceId === 'string' ? [sourceId] : [];
      });

      if (!hasFinalMessage && reply && !TERMINAL_STATES.has(execution.status)) {
        const artifactId = randomUUID();
        const safeReply = redactExecutionText(reply);
        const body = Buffer.from(safeReply, 'utf8');
        await manager.save(
          manager.getRepository(ExecutionArtifactEntity).create({
            artifactId,
            rootExecutionId: execution.rootExecutionId,
            kind: 'model_response',
            contentHash: contentHash(body),
            size: String(body.length),
            mediaType: 'text/plain',
            encoding: 'identity',
            dataClassification: 'workspace',
            redaction: { applied: safeReply !== reply },
            retentionClass: 'evaluation',
            createdByEventId: null,
            inputSourceIds: observedSourceIds,
            storageRef: `execution:${execution.rootExecutionId}:artifact:${artifactId}`,
            body,
          }),
        );
        sequence += 1;
        const messageEvent = await this.appendBackendEvent(
          manager,
          root,
          ++nextProducerSequence,
          {
            eventType: 'message.recorded',
            payloadSchema: 'message.recorded/1',
            payload: {
              messageKind: 'final_response',
              role: 'assistant',
              contentPreview: safeReply.slice(0, 512),
              contentArtifactId: artifactId,
              format: 'text',
              ...(completion?.source
                ? { generationSource: completion.source }
                : {}),
            },
            actor: { type: 'system' },
            executionId: execution.executionId,
            turnId: execution.turnId,
            causedByEventId: lastEventId,
            artifactRefs: [artifactId],
            redactionApplied: safeReply !== reply,
          },
          sequence,
        );
        lastEventId = messageEvent.eventId;
      } else if (!hasFinalMessage && !error) {
        this.addMissing(execution, 'final_message');
      }

      if (!TERMINAL_STATES.has(execution.status)) {
        const progress = await this.progress.refreshProjection(
          eventRepo,
          execution,
        );
        sequence += 1;
        const progressEvent = await this.appendBackendEvent(
          manager,
          root,
          ++nextProducerSequence,
          {
            eventType: 'progress.reported',
            payloadSchema: 'progress.reported/1',
            payload: {
              message: 'Durable progress ledger recorded',
              kind: 'ledger_snapshot',
              ledger: progress.ledger,
            },
            actor: { type: 'system' },
            executionId: execution.executionId,
            turnId: execution.turnId,
            causedByEventId: lastEventId,
            artifactRefs: [],
          },
          sequence,
        );
        lastEventId = progressEvent.eventId;

        sequence += 1;
        const status = error ? 'failed' : 'completed';
        const completionKind = completion?.kind ?? 'full';
        const completionReason =
          completion?.reason ??
          (error ? 'model_or_tool_failed' : 'goal_satisfied');
        const finalResult = error
          ? null
          : {
              ...(execution.result && typeof execution.result === 'object'
                ? execution.result
                : {}),
              reply: redactExecutionText(reply),
            };
        const stateEvent = await this.appendBackendEvent(
          manager,
          root,
          ++nextProducerSequence,
          {
            eventType: 'execution.state_changed',
            payloadSchema: 'execution.state_changed/1',
            payload: {
              from: execution.status,
              to: status,
              completionKind,
              completionReason,
              ...(completion?.source
                ? { completionSource: completion.source }
                : {}),
              ...(completion?.partialResult
                ? { partialResult: completion.partialResult }
                : {}),
              result: finalResult,
              error: error
                ? {
                    code:
                      completionReason === 'partial_loop_guard'
                        ? 'IMMEDIATE_EXACT_TOOL_REPEAT_PERSISTED'
                        : 'CHAT_FAILED',
                    message: redactExecutionText(error),
                  }
                : null,
            },
            actor: { type: 'system' },
            executionId: execution.executionId,
            turnId: execution.turnId,
            causedByEventId: lastEventId,
            artifactRefs: [],
          },
          sequence,
        );
        lastEventId = stateEvent.eventId;
        terminalEventId = stateEvent.eventId;
        execution.status = status as ExecutionStatus;
        execution.completionKind = completionKind;
        execution.completionReason = completionReason;
        execution.result = finalResult;
        execution.error = error
          ? {
              code:
                completionReason === 'partial_loop_guard'
                  ? 'IMMEDIATE_EXACT_TOOL_REPEAT_PERSISTED'
                  : 'CHAT_FAILED',
              message: redactExecutionText(error),
            }
          : null;
      }
      execution.lastSequence = String(sequence);
      execution.lastEventId = lastEventId;
      execution.completedAt = new Date();
      execution.phase = null;
      await finishSkillActivations(
        manager,
        execution.executionId,
        execution.status,
      );
      await this.progress.refreshProjection(eventRepo, execution);
      await executionRepo.save(execution);
      if (root.executionId !== execution.executionId) {
        root.lastSequence = String(sequence);
        root.lastEventId = lastEventId;
        await this.progress.refreshProjection(eventRepo, root);
        await executionRepo.save(root);
      }
      if (terminalEventId) {
        await this.appendTerminalPublication(
          manager,
          execution,
          terminalEventId,
          resolvedPublication,
        );
      }
    });
  }

  async validateDeterministicPartial(
    executionId: string,
    reply: string,
    error: string | null,
    completion: ExecutionCompletion,
  ): Promise<void> {
    const execution = await this.executionRepo.findOne({
      where: { executionId },
    });
    if (!execution) {
      throw new NotFoundException(`Execution ${executionId} not found`);
    }
    const rows = await this.eventRepo.find({
      where: { rootExecutionId: execution.rootExecutionId },
      order: { sequence: 'ASC' },
    });
    const artifacts = await this.loadArtifactsWithBody(
      this.artifactRepo,
      execution.rootExecutionId,
    );
    this.assertLoopDetectedCompletion(execution, rows, error, completion);
    this.assertDeterministicPartial(
      execution,
      rows,
      artifacts,
      reply,
      error,
      completion,
    );
  }

  private loadArtifactsWithBody(
    repository: Repository<ExecutionArtifactEntity>,
    rootExecutionId: string,
  ): Promise<ExecutionArtifactEntity[]> {
    return repository
      .createQueryBuilder('artifact')
      .addSelect('artifact.body')
      .where('artifact.root_execution_id = :rootExecutionId', {
        rootExecutionId,
      })
      .getMany();
  }

  private assertDeterministicPartial(
    execution: ExecutionEntity,
    rows: ExecutionEventEntity[],
    artifacts: ExecutionArtifactEntity[],
    reply: string,
    error: string | null,
    completion?: ExecutionCompletion,
  ): void {
    if (completion?.source !== 'runtime_template') {
      if (completion?.partialResult) {
        throw new BadRequestException(
          'partialResult requires completionSource=runtime_template',
        );
      }
      return;
    }
    if (
      error ||
      completion.kind !== 'partial' ||
      !['partial_budget_exhausted', 'partial_loop_guard'].includes(
        String(completion.reason),
      )
    ) {
      throw new BadRequestException(
        'Runtime template completion must be a supported successful partial',
      );
    }
    const partial = completion.partialResult;
    if (!partial) {
      throw new BadRequestException(
        'Runtime template completion requires partialResult',
      );
    }
    this.assertPartialShape(partial);

    const finalMessages = rows.filter((row) => {
      const envelope = row.envelope as Record<string, any>;
      const payload = envelope['payload'] as Record<string, any> | undefined;
      return (
        row.executionId === execution.executionId &&
        row.eventType === 'message.recorded' &&
        payload?.['messageKind'] === 'final_response' &&
        payload?.['generationSource'] === 'runtime_template' &&
        (envelope['actor'] as Record<string, any> | undefined)?.['type'] ===
          'system'
      );
    });
    if (finalMessages.length !== 1) {
      throw new BadRequestException(
        'Runtime template requires one correctly attributed final message',
      );
    }
    const finalMessage = finalMessages[0];
    const finalPayload = finalMessage.envelope['payload'] as Record<
      string,
      unknown
    >;
    const artifactId = finalPayload['contentArtifactId'];
    const artifactRefs = finalMessage.envelope['artifactRefs'];
    const artifact = artifacts.find((item) => item.artifactId === artifactId);
    const safeReply = redactExecutionText(reply);
    if (
      typeof artifactId !== 'string' ||
      !Array.isArray(artifactRefs) ||
      !artifactRefs.includes(artifactId) ||
      finalPayload['contentPreview'] !== safeReply.slice(0, 512) ||
      !artifact ||
      artifact.rootExecutionId !== execution.rootExecutionId ||
      artifact.kind !== 'model_response' ||
      artifact.mediaType !== 'text/plain' ||
      !artifact.body ||
      artifact.body.toString('utf8') !== safeReply ||
      artifact.contentHash !== contentHash(Buffer.from(safeReply, 'utf8')) ||
      Number(artifact.size) !== Buffer.byteLength(safeReply, 'utf8')
    ) {
      throw new BadRequestException(
        'Runtime template final artifact differs from the completed reply',
      );
    }

    const operationIds = new Set<string>();
    let previousSequence = -1;
    for (const item of partial.completedOperations) {
      if (operationIds.has(item.operationId)) {
        throw new BadRequestException(
          'Duplicate deterministic partial operation',
        );
      }
      operationIds.add(item.operationId);
      const finish = rows.find(
        (row) =>
          row.executionId === execution.executionId &&
          row.operationId === item.operationId &&
          row.eventType === 'operation.finished',
      );
      const start = rows.find(
        (row) =>
          row.executionId === execution.executionId &&
          row.operationId === item.operationId &&
          row.eventType === 'operation.started',
      );
      const finishEnvelope = finish?.envelope as
        Record<string, any> | undefined;
      const startEnvelope = start?.envelope as Record<string, any> | undefined;
      const finishPayload = finishEnvelope?.['payload'] as
        Record<string, any> | undefined;
      const startPayload = startEnvelope?.['payload'] as
        Record<string, any> | undefined;
      if (
        !finish ||
        !start ||
        finishPayload?.['operationKind'] !== 'tool_call' ||
        finishPayload?.['status'] !== 'succeeded' ||
        finishPayload?.['resultSummaryKind'] !== 'leaf_tool' ||
        finishPayload?.['resultSummary'] !== item.summary ||
        startPayload?.['name'] !== item.name ||
        startPayload?.['loopKind'] !== 'top_level' ||
        startPayload?.['loopId'] !== partial.loopId ||
        startPayload?.['budgetGrantId'] !== partial.grantId ||
        startEnvelope?.['toolCallId'] !== item.toolCallId
      ) {
        throw new BadRequestException(
          `Invalid deterministic partial operation ${item.operationId}`,
        );
      }
      const sequence = Number(finish.sequence);
      if (sequence <= previousSequence) {
        throw new BadRequestException(
          'Deterministic partial operations are not in durable order',
        );
      }
      previousSequence = sequence;
    }

    const loopStarts = rows.filter((row) => {
      const envelope = row.envelope as Record<string, any>;
      const payload = envelope['payload'] as Record<string, any> | undefined;
      return (
        row.executionId === execution.executionId &&
        row.eventType === 'operation.started' &&
        payload?.['operationKind'] === 'tool_call' &&
        payload?.['loopId'] === partial.loopId &&
        payload?.['budgetGrantId'] === partial.grantId
      );
    });
    for (const start of loopStarts) {
      const finish = rows.find(
        (row) =>
          row.executionId === execution.executionId &&
          row.operationId === start.operationId &&
          row.eventType === 'operation.finished',
      );
      const payload = finish?.envelope['payload'] as
        Record<string, any> | undefined;
      if (
        !finish ||
        ['dispatched', 'unknown'].includes(String(payload?.['status']))
      ) {
        throw new BadRequestException(
          'Runtime template completion has an ambiguous tool operation',
        );
      }
    }
    if (partial.trigger === 'exact_tool_repeat_persisted') {
      const termination = rows.some((row) => {
        const payload = row.envelope['payload'] as
          Record<string, any> | undefined;
        const signal = payload?.['loopGuardSignal'] as
          Record<string, any> | undefined;
        return (
          row.executionId === execution.executionId &&
          row.eventType === 'progress.reported' &&
          payload?.['kind'] === 'loop_guard_triggered' &&
          signal?.['action'] === 'terminate' &&
          signal?.['grantId'] === partial.grantId &&
          signal?.['loopId'] === partial.loopId
        );
      });
      if (!termination) {
        throw new BadRequestException(
          'Runtime template loop termination is not durable',
        );
      }
    } else if (partial.trigger === 'closing_output_empty') {
      const closingStart = rows.find((row) => {
        const payload = row.envelope['payload'] as
          Record<string, any> | undefined;
        return (
          row.executionId === execution.executionId &&
          row.eventType === 'operation.started' &&
          payload?.['operationKind'] === 'inference' &&
          payload?.['phase'] === 'forced_finalization' &&
          payload?.['loopId'] === partial.loopId &&
          payload?.['budgetGrantId'] === partial.grantId
        );
      });
      const closingFinish = closingStart
        ? rows.find((row) => {
            const payload = row.envelope['payload'] as
              Record<string, any> | undefined;
            return (
              row.executionId === execution.executionId &&
              row.operationId === closingStart.operationId &&
              row.eventType === 'operation.finished' &&
              payload?.['operationKind'] === 'inference' &&
              payload?.['outcome'] === 'invalid' &&
              payload?.['reason'] === 'empty_model_response'
            );
          })
        : undefined;
      if (!closingStart || !closingFinish) {
        throw new BadRequestException(
          'Runtime template closing output was not durably invalid',
        );
      }
    } else {
      const closingUnavailable = rows.some((row) => {
        const payload = row.envelope['payload'] as
          Record<string, any> | undefined;
        const reservation = payload?.['reservation'] as
          Record<string, any> | undefined;
        const grant = payload?.['grant'] as Record<string, any> | undefined;
        return (
          row.executionId === execution.executionId &&
          ((row.eventType === 'progress.reported' &&
            payload?.['kind'] === 'budget_reservation' &&
            reservation?.['grantId'] === partial.grantId &&
            reservation?.['bucket'] === 'closing' &&
            reservation?.['status'] === 'denied') ||
            (row.eventType === 'progress.reported' &&
              payload?.['kind'] === 'budget_grant' &&
              grant?.['grantId'] === partial.grantId &&
              Number(grant?.['effectivePolicy']?.['closing']) === 0))
        );
      });
      if (!closingUnavailable) {
        throw new BadRequestException(
          'Runtime template closing unavailability is not durable',
        );
      }
    }
  }

  private assertPartialShape(partial: DeterministicPartialResult): void {
    if (
      partial.version !== '1' ||
      ![
        'closing_unavailable',
        'closing_output_empty',
        'exact_tool_repeat_persisted',
      ].includes(partial.trigger) ||
      !EXECUTION_UUID_PATTERN.test(partial.loopId) ||
      !EXECUTION_UUID_PATTERN.test(partial.grantId) ||
      !Array.isArray(partial.completedOperations) ||
      partial.completedOperations.length === 0 ||
      !Array.isArray(partial.pending) ||
      partial.pending.length !== 1
    ) {
      throw new BadRequestException('Invalid deterministic partial result');
    }
    const loopPartial = partial.trigger === 'exact_tool_repeat_persisted';
    if (
      (loopPartial &&
        (partial.pending[0] !== 'strategy_change' ||
          partial.continuation?.kind !== 'new_turn' ||
          partial.continuation.reason !== 'different_strategy_required')) ||
      (!loopPartial &&
        (partial.pending[0] !== 'final_synthesis' ||
          partial.continuation !== undefined))
    ) {
      throw new BadRequestException('Invalid deterministic partial result');
    }
    for (const item of partial.completedOperations) {
      if (
        !item ||
        !EXECUTION_UUID_PATTERN.test(item.operationId) ||
        !EXECUTION_UUID_PATTERN.test(item.toolCallId) ||
        !item.name ||
        !item.summary ||
        item.summary.length > 200
      ) {
        throw new BadRequestException(
          'Invalid deterministic partial operation reference',
        );
      }
    }
  }

  private assertLoopDetectedCompletion(
    execution: ExecutionEntity,
    rows: ExecutionEventEntity[],
    error: string | null,
    completion?: ExecutionCompletion,
  ): void {
    if (completion?.reason !== 'partial_loop_guard') return;
    const hasTermination = rows.some((row) => {
      const payload = row.envelope.payload as Record<string, any> | undefined;
      const signal = payload?.loopGuardSignal as
        Record<string, unknown> | undefined;
      return (
        row.executionId === execution.executionId &&
        row.eventType === 'progress.reported' &&
        payload?.kind === 'loop_guard_triggered' &&
        signal?.action === 'terminate'
      );
    });
    if (!hasTermination) {
      throw new BadRequestException(
        'Loop-detected completion requires a durable termination signal',
      );
    }
    if (error && (completion.kind === 'partial' || completion.partialResult)) {
      throw new BadRequestException(
        'Failed loop termination cannot contain a partial result',
      );
    }
    if (!error && completion.source !== 'runtime_template') {
      throw new BadRequestException(
        'Successful loop termination requires a runtime template',
      );
    }
  }

  async readEvents(
    rootExecutionId: string,
    scope: ExecutionAccessScope,
    afterSequence = 0,
    limit = 100,
  ) {
    await this.findOwned(rootExecutionId, scope);
    const boundedLimit = Math.min(Math.max(limit, 1), 500);
    const rows = await this.eventRepo.find({
      where: {
        rootExecutionId,
        sequence: MoreThan(String(Math.max(afterSequence, 0))),
      },
      order: { sequence: 'ASC' },
      take: boundedLimit + 1,
    });
    const hasMore = rows.length > boundedLimit;
    const page = hasMore ? rows.slice(0, boundedLimit) : rows;
    return {
      events: page.map((row) => row.envelope),
      afterSequence,
      nextAfterSequence: page.length
        ? Number(page.at(-1).sequence)
        : afterSequence,
      hasMore,
    };
  }

  async readProgress(rootExecutionId: string, scope: ExecutionAccessScope) {
    const execution = await this.findOwned(rootExecutionId, scope);
    const tree = await this.executionRepo.find({
      where: { rootExecutionId },
      order: { createdAt: 'ASC' },
    });
    const activeSteps = await this.dataSource
      .getRepository(ExecutionStepEntity)
      .find({
        where: {
          executionId: In(tree.map((item) => item.executionId)),
          status: In([
            ExecutionStepStatus.BLOCKED,
            ExecutionStepStatus.READY,
            ExecutionStepStatus.RUNNING,
            ExecutionStepStatus.RESULT_RECEIVED,
          ]),
        },
        order: { createdAt: 'ASC' },
      });
    const attemptIds = activeSteps
      .map((step) => step.currentAttemptId)
      .filter((id): id is string => Boolean(id));
    const attempts = attemptIds.length
      ? await this.dataSource
          .getRepository(ExecutionStepAttemptEntity)
          .findBy({ attemptId: In(attemptIds) })
      : [];
    const attemptsById = new Map(
      attempts.map((attempt) => [attempt.attemptId, attempt]),
    );
    const workerIds = [
      ...new Set(attempts.map((attempt) => attempt.claimedBy)),
    ];
    const workers = workerIds.length
      ? await this.dataSource
          .getRepository(WorkerEntity)
          .findBy({ id: In(workerIds) })
      : [];
    const workersById = new Map(workers.map((worker) => [worker.id, worker]));
    return {
      policy: execution.progressPolicy,
      ledger: execution.progressLedger,
      runtime: {
        status: execution.status,
        activeSteps: activeSteps.map((step) => {
          const attempt = step.currentAttemptId
            ? attemptsById.get(step.currentAttemptId)
            : undefined;
          const worker = attempt
            ? workersById.get(attempt.claimedBy)
            : undefined;
          return {
            executionId: step.executionId,
            stepId: step.stepId,
            taskType:
              typeof step.work?.taskType === 'string'
                ? step.work.taskType
                : null,
            stepKind: step.stepKind,
            stepStatus: step.status,
            attemptId: attempt?.attemptId ?? null,
            attemptStatus: attempt?.status ?? null,
            worker: worker
              ? {
                  workerId: worker.id,
                  name: worker.name,
                  kind: worker.workerKind,
                }
              : null,
          };
        }),
      },
    };
  }

  async exportBundle(
    rootExecutionId: string,
    scope: ExecutionAccessScope,
    evaluationConsentGranted: boolean,
  ) {
    if (!evaluationConsentGranted) {
      throw new ForbiddenException(
        'Explicit consent is required to export evaluation evidence',
      );
    }
    const execution = await this.findOwned(rootExecutionId, scope);
    const events = (
      await this.eventRepo.find({
        where: { rootExecutionId },
        order: { sequence: 'ASC' },
      })
    ).map((row) => row.envelope);
    const artifacts = await this.artifactRepo
      .createQueryBuilder('artifact')
      .addSelect('artifact.body')
      .where('artifact.root_execution_id = :rootExecutionId', {
        rootExecutionId,
      })
      .orderBy('artifact.created_at', 'ASC')
      .getMany();
    const skillActivations = await this.dataSource
      .getRepository(SkillActivationEntity)
      .createQueryBuilder('activation')
      .innerJoin(
        ExecutionEntity,
        'execution',
        'execution.executionId = activation.executionId',
      )
      .where('execution.rootExecutionId = :rootExecutionId', {
        rootExecutionId,
      })
      .orderBy('activation.activatedAt', 'ASC')
      .getMany();
    const embeddedArtifacts: Record<
      string,
      { encoding: 'base64'; data: string }
    > = {};
    const artifactManifest = artifacts.map((artifact) => {
      if (artifact.body) {
        embeddedArtifacts[artifact.artifactId] = {
          encoding: 'base64',
          data: artifact.body.toString('base64'),
        };
      }
      return {
        artifactId: artifact.artifactId,
        kind: artifact.kind,
        contentHash: artifact.contentHash,
        size: Number(artifact.size),
        mediaType: artifact.mediaType,
        encoding: artifact.encoding,
        storageRef: artifact.storageRef,
        createdByEventId: artifact.createdByEventId ?? undefined,
        inputSourceIds: artifact.inputSourceIds,
        dataClassification: artifact.dataClassification,
        redaction: artifact.redaction,
        retentionClass: artifact.retentionClass,
        omissionReason: artifact.body ? undefined : 'not_captured',
      };
    });
    const firstSequence = events.length ? Number(events[0].sequence) : 0;
    const lastSequence = events.length ? Number(events.at(-1).sequence) : 0;
    const inferenceIdentities = await this.readInferenceIdentities(events);
    const toolIdentities = await this.readToolVersions(events);
    const environment = {
      codeFingerprints: inferenceIdentities.codeFingerprints,
      promptPackages: inferenceIdentities.promptPackages,
      toolVersions: toolIdentities.toolVersions,
      modelFingerprints: inferenceIdentities.modelFingerprints,
      adapterFingerprints: inferenceIdentities.adapterFingerprints,
      runtimeFingerprints: inferenceIdentities.runtimeFingerprints,
      featureFlags: {},
    };
    const missingEvidence = this.deriveBundleMissingEvidence(
      execution,
      events,
      artifacts,
      environment,
      { ...inferenceIdentities, ...toolIdentities },
    );
    const completenessStatus = missingEvidence.length
      ? 'evaluable_partial'
      : execution.completenessStatus;
    const bundle: Record<string, unknown> = {
      bundleSchema: EXECUTION_BUNDLE_SCHEMA,
      bundleId: randomUUID(),
      rootExecutionId,
      executionSchema: EXECUTION_EVENT_SCHEMA,
      product: 'documents',
      eventRange: { firstSequence, lastSequence },
      events,
      skillActivations: skillActivations.map((activation) => ({
        schemaVersion: activation.schemaVersion,
        activationId: activation.activationId,
        executionId: activation.executionId,
        skillId: activation.skillId,
        skillVersion: activation.skillVersion,
        contentHash: activation.contentHash,
        activationReason: activation.activationReason,
        inputBindings: activation.inputBindings,
        phase: activation.phase,
        checkpoint: activation.checkpoint,
        status: activation.status,
        activatedAt: activation.activatedAt.toISOString(),
        finishedAt: activation.finishedAt?.toISOString() ?? null,
      })),
      artifacts: artifactManifest,
      embeddedArtifacts,
      environment,
      redactionProfile: 'evaluation-default',
      bundleCompleteness: {
        status: completenessStatus,
        reproducible: completenessStatus === 'reproducible',
        missing: missingEvidence,
      },
      integrity: {
        eventsHash: canonicalHash(events),
        schemaManifestHash: EXECUTION_CONTRACT_SET_HASH,
      },
      policySummary: {
        decision: 'allow',
        purpose: 'evaluation',
        consent: {
          status: 'granted',
          basis: 'explicit_export_request',
        },
        allowedDestinations: ['ai-train'],
        retentionClass: 'evaluation',
        accessScope: scope,
      },
      exportedAt: new Date().toISOString(),
    };
    bundle.manifestHash = canonicalHash(bundle);
    this.contractValidator.assertBundle(bundle);
    return bundle;
  }

  private deriveBundleMissingEvidence(
    execution: ExecutionEntity,
    events: Record<string, unknown>[],
    artifacts: ExecutionArtifactEntity[],
    environment: Record<string, unknown>,
    inferenceIdentities: {
      modelIdentityKnown: boolean;
      adapterIdentityKnown: boolean;
      promptIdentityKnown: boolean;
      codeIdentityKnown: boolean;
      toolIdentityKnown: boolean;
      runtimeIdentityKnown: boolean;
    } = {
      modelIdentityKnown: false,
      adapterIdentityKnown: false,
      promptIdentityKnown: false,
      codeIdentityKnown: false,
      toolIdentityKnown: false,
      runtimeIdentityKnown: false,
    },
  ): string[] {
    const missing = new Set(execution.missingEvidence ?? []);

    const starts = new Map<string, Record<string, unknown>>();
    const finishes = new Set<string>();
    let hasInference = false;
    let hasTool = false;
    for (const event of events) {
      const eventType = String(event.eventType ?? '');
      const operationId = String(event.operationId ?? '');
      const attemptId = String(event.attemptId ?? '');
      const operationKey = `${operationId}:${attemptId}`;
      const payload = (event.payload ?? {}) as Record<string, unknown>;
      if (eventType === 'operation.started') {
        starts.set(operationKey, event);
        hasInference ||= payload.operationKind === 'inference';
        hasTool ||= payload.operationKind === 'tool_call';
      }
      if (eventType !== 'operation.finished') continue;
      finishes.add(operationKey);
      const metrics = (payload.metrics ?? {}) as Record<string, unknown>;
      for (const [key, value] of Object.entries(metrics)) {
        if (value === 'unknown') {
          missing.add(`operation.${operationId}.metrics.${key}`);
        }
      }
    }
    for (const [operationKey, event] of starts) {
      if (!finishes.has(operationKey)) {
        missing.add(`operation.${String(event.operationId)}.finish`);
      }
    }
    if (hasInference) {
      if (!inferenceIdentities.codeIdentityKnown) {
        missing.add('environment.codeFingerprints');
      }
      if (!inferenceIdentities.modelIdentityKnown) {
        missing.add('environment.modelFingerprints');
      }
      if (!inferenceIdentities.adapterIdentityKnown) {
        missing.add('environment.adapterFingerprints');
      }
      if (!inferenceIdentities.promptIdentityKnown) {
        missing.add('environment.promptPackages');
      }
    }
    if (hasTool && !inferenceIdentities.toolIdentityKnown) {
      missing.add('environment.toolVersions');
    }
    if (!inferenceIdentities.runtimeIdentityKnown) {
      missing.add('environment.runtimeFingerprints');
    }
    for (const artifact of artifacts) {
      if (artifact.body === null) {
        missing.add(`artifact.${artifact.artifactId}.body`);
      }
    }
    return [...missing].sort();
  }

  private async readInferenceIdentities(
    events: Record<string, unknown>[],
  ): Promise<{
    modelFingerprints: string[];
    adapterFingerprints: string[];
    promptPackages: string[];
    codeFingerprints: string[];
    runtimeFingerprints: string[];
    modelIdentityKnown: boolean;
    adapterIdentityKnown: boolean;
    promptIdentityKnown: boolean;
    codeIdentityKnown: boolean;
    runtimeIdentityKnown: boolean;
  }> {
    const inferenceOperationIds = new Set(
      events
        .filter(
          (event) =>
            event.eventType === 'operation.started' &&
            (event.payload as Record<string, unknown> | undefined)
              ?.operationKind === 'inference',
        )
        .map((event) => String(event.operationId)),
    );
    const executionIds = [
      ...new Set(events.map((event) => String(event.executionId))),
    ].filter(Boolean);
    const operationIds = new Set(
      events
        .filter((event) => event.eventType === 'operation.started')
        .map((event) => String(event.operationId)),
    );
    const runtimeFingerprints = new Set<string>();
    for (const event of events) {
      const runtimeFingerprint = (
        event.producer as Record<string, unknown> | undefined
      )?.runtimeFingerprint;
      if (
        typeof runtimeFingerprint === 'string' &&
        EXECUTION_CONTENT_HASH_PATTERN.test(runtimeFingerprint)
      ) {
        runtimeFingerprints.add(runtimeFingerprint);
      }
    }
    if (operationIds.size === 0 || executionIds.length === 0) {
      return {
        modelFingerprints: [],
        adapterFingerprints: [],
        promptPackages: [],
        codeFingerprints: [],
        runtimeFingerprints: [...runtimeFingerprints].sort(),
        modelIdentityKnown: inferenceOperationIds.size === 0,
        adapterIdentityKnown: inferenceOperationIds.size === 0,
        promptIdentityKnown: inferenceOperationIds.size === 0,
        codeIdentityKnown: inferenceOperationIds.size === 0,
        runtimeIdentityKnown:
          operationIds.size === 0 && runtimeFingerprints.size > 0,
      };
    }

    const receipts = await this.dataSource
      .getRepository(ExecutionResultReceiptEntity)
      .find({ where: { executionId: In(executionIds) } });
    const modelFingerprints = new Set<string>();
    const adapterFingerprints = new Set<string>();
    const promptPackages = new Set<string>();
    const codeFingerprints = new Set<string>();
    const modelOperations = new Set<string>();
    const adapterOperations = new Set<string>();
    const promptOperations = new Set<string>();
    const codeOperations = new Set<string>();
    const runtimeOperations = new Set<string>();
    for (const receipt of receipts) {
      if (!operationIds.has(receipt.operationId)) continue;
      const runtimeFingerprint = receipt.result?.runtimeFingerprint;
      if (
        typeof runtimeFingerprint === 'string' &&
        EXECUTION_CONTENT_HASH_PATTERN.test(runtimeFingerprint)
      ) {
        runtimeFingerprints.add(runtimeFingerprint);
        runtimeOperations.add(receipt.operationId);
      }
      if (!inferenceOperationIds.has(receipt.operationId)) continue;
      const codeFingerprint = receipt.result?.codeFingerprint;
      if (
        typeof codeFingerprint === 'string' &&
        EXECUTION_CONTENT_HASH_PATTERN.test(codeFingerprint)
      ) {
        codeFingerprints.add(codeFingerprint);
        codeOperations.add(receipt.operationId);
      }
      const inference = receipt.result?.inference;
      if (!inference || typeof inference !== 'object') continue;
      const metadata = inference as Record<string, unknown>;
      if (
        typeof metadata.effectiveModel === 'string' &&
        metadata.effectiveModel
      ) {
        modelFingerprints.add(metadata.effectiveModel);
        modelOperations.add(receipt.operationId);
      }
      if (Object.prototype.hasOwnProperty.call(metadata, 'effectiveAdapter')) {
        adapterOperations.add(receipt.operationId);
        if (
          typeof metadata.effectiveAdapter === 'string' &&
          metadata.effectiveAdapter
        ) {
          adapterFingerprints.add(metadata.effectiveAdapter);
        }
      }
      if (
        Array.isArray(metadata.effectivePromptPackages) &&
        metadata.effectivePromptPackages.length > 0 &&
        metadata.effectivePromptPackages.every(
          (value) => typeof value === 'string' && value.length > 0,
        )
      ) {
        promptOperations.add(receipt.operationId);
        for (const promptPackage of metadata.effectivePromptPackages) {
          promptPackages.add(promptPackage as string);
        }
      }
    }
    const coversEveryInference = (covered: Set<string>) =>
      [...inferenceOperationIds].every((operationId) =>
        covered.has(operationId),
      );
    return {
      modelFingerprints: [...modelFingerprints].sort(),
      adapterFingerprints: [...adapterFingerprints].sort(),
      promptPackages: [...promptPackages].sort(),
      codeFingerprints: [...codeFingerprints].sort(),
      runtimeFingerprints: [...runtimeFingerprints].sort(),
      modelIdentityKnown: coversEveryInference(modelOperations),
      adapterIdentityKnown: coversEveryInference(adapterOperations),
      promptIdentityKnown: coversEveryInference(promptOperations),
      codeIdentityKnown: coversEveryInference(codeOperations),
      runtimeIdentityKnown: [...operationIds].every((operationId) =>
        runtimeOperations.has(operationId),
      ),
    };
  }

  private async readToolVersions(events: Record<string, unknown>[]): Promise<{
    toolVersions: string[];
    toolIdentityKnown: boolean;
  }> {
    const operationIds = new Set(
      events
        .filter(
          (event) =>
            event.eventType === 'operation.started' &&
            (event.payload as Record<string, unknown> | undefined)
              ?.operationKind === 'tool_call',
        )
        .map((event) => String(event.operationId)),
    );
    if (operationIds.size === 0) {
      return { toolVersions: [], toolIdentityKnown: true };
    }
    const plans = await this.dataSource
      .getRepository(ExecutionToolPlanEntity)
      .find({ where: { operationId: In([...operationIds]) } });
    const covered = new Set<string>();
    const versions = new Set<string>();
    for (const plan of plans) {
      const version = plan.plan?.descriptorVersion;
      if (
        operationIds.has(plan.operationId) &&
        typeof version === 'string' &&
        version
      ) {
        covered.add(plan.operationId);
        versions.add(version);
      }
    }
    return {
      toolVersions: [...versions].sort(),
      toolIdentityKnown: [...operationIds].every((operationId) =>
        covered.has(operationId),
      ),
    };
  }

  private async findOwned(
    rootExecutionId: string,
    scope: ExecutionAccessScope,
  ) {
    const execution = await this.executionRepo.findOne({
      where: {
        executionId: rootExecutionId,
        rootExecutionId,
        ownerPrincipal: scope.ownerPrincipal,
      },
    });
    if (!execution) throw new NotFoundException('Execution not found');
    return execution;
  }

  private async appendBackendEvent(
    manager: EntityManager,
    execution: ExecutionEntity,
    producerSequence: number,
    data: BackendExecutionEventData,
    assignedSequence?: number,
  ): Promise<ExecutionEventEntity> {
    return appendBackendExecutionEvent(
      manager,
      execution,
      producerSequence,
      data,
      assignedSequence,
    );
  }

  private validateIncomingEvent(
    execution: ExecutionEntity,
    event: Record<string, unknown>,
  ): void {
    rejectForbiddenData(event);
    for (const field of ['eventId', 'rootExecutionId', 'executionId']) {
      if (!EXECUTION_UUID_PATTERN.test(String(event[field] ?? ''))) {
        throw new BadRequestException(`${field} must be a UUID`);
      }
    }
    if (event.rootExecutionId !== execution.rootExecutionId) {
      throw new BadRequestException(
        'Event identity is outside execution scope',
      );
    }
    const eventType = String(event.eventType ?? '');
    if (EXECUTION_EVENT_PAYLOADS[eventType] !== event.payloadSchema) {
      throw new BadRequestException(
        `Unsupported event or payload schema: ${eventType}`,
      );
    }
    const producer = event.producer;
    if (!producer || typeof producer !== 'object') {
      throw new BadRequestException('producer is required');
    }
    const producerRecord = producer as Record<string, unknown>;
    if (
      producerRecord.component !== 'documents-models' ||
      !String(producerRecord.instanceId ?? '').trim()
    ) {
      throw new BadRequestException(
        'Only documents-models may use internal ingestion',
      );
    }
    if (
      !Number.isInteger(event.producerSequence) ||
      Number(event.producerSequence) < 1
    ) {
      throw new BadRequestException(
        'producerSequence must be a positive integer',
      );
    }
    if (Number.isNaN(new Date(String(event.occurredAt ?? '')).getTime())) {
      throw new BadRequestException('occurredAt must be a timestamp');
    }
    const security = event.security as Record<string, unknown> | undefined;
    if (security?.dataClassification === 'secret') {
      throw new BadRequestException('Secret data cannot enter a execution');
    }
    if (
      !event.payload ||
      typeof event.payload !== 'object' ||
      !Array.isArray(event.artifactRefs)
    ) {
      throw new BadRequestException('payload and artifactRefs are required');
    }
    const payload = event.payload as Record<string, unknown>;
    if (
      eventType === 'progress.reported' &&
      (payload.kind === 'budget_grant' ||
        payload.kind === 'budget_reservation' ||
        payload.kind === 'budget_soft_limit_reached' ||
        payload.kind === 'loop_guard_triggered')
    ) {
      throw new BadRequestException(
        'Budget decisions can only be emitted by documents-backend',
      );
    }
    this.contractValidator.assertEvent({
      ...event,
      schemaVersion: EXECUTION_EVENT_SCHEMA,
      sequence: 1,
      ingestedAt: event.occurredAt,
      contentHash: `sha256:${'0'.repeat(64)}`,
    });
  }

  private validateArtifact(artifact: IncomingExecutionArtifact): void {
    rejectForbiddenData(artifact);
    if (
      !artifact ||
      !EXECUTION_UUID_PATTERN.test(String(artifact.artifactId ?? ''))
    ) {
      throw new BadRequestException('artifactId must be a UUID');
    }
    if (
      !EXECUTION_CONTENT_HASH_PATTERN.test(
        String(artifact.contentHash ?? ''),
      ) ||
      !Number.isInteger(artifact.size) ||
      artifact.size < 0 ||
      artifact.size > MAX_ARTIFACT_BYTES ||
      !artifact.mediaType ||
      !artifact.kind
    ) {
      throw new BadRequestException(
        `Invalid artifact manifest: ${artifact.artifactId}`,
      );
    }
    if (artifact.dataClassification === 'secret') {
      throw new BadRequestException('Secret artifacts cannot be persisted');
    }
    this.contractValidator.assertArtifact({
      ...artifact,
      storageRef: `execution:pending:artifact:${artifact.artifactId}`,
      encoding: artifact.encoding ?? 'identity',
      redaction: artifact.redaction ?? { applied: false },
      retentionClass: artifact.retentionClass ?? 'evaluation',
    });
  }

  private rejectSensitiveArtifactBody(
    artifact: IncomingExecutionArtifact,
    body: Buffer,
  ): void {
    if (!/^(text\/|application\/(json|[^;]+\+json))/.test(artifact.mediaType)) {
      return;
    }
    const text = body.toString('utf8');
    if (/^application\/(json|[^;]+\+json)/.test(artifact.mediaType)) {
      try {
        const value = JSON.parse(text);
        rejectForbiddenData(value, '$artifact');
        rejectSensitiveStrings(value, '$artifact');
      } catch (error) {
        if (error instanceof BadRequestException) throw error;
      }
      return;
    }
    if (
      PRIVATE_REASONING_DETECTOR.test(text) ||
      BEARER_DETECTOR.test(text) ||
      SECRET_VALUE_DETECTOR.test(text)
    ) {
      throw new BadRequestException(
        `Artifact contains unredacted sensitive text: ${artifact.artifactId}`,
      );
    }
  }

  private materializeState(
    execution: ExecutionEntity,
    event: Record<string, unknown>,
  ): void {
    if (event.eventType !== 'execution.state_changed') return;
    const payload = event.payload as Record<string, unknown>;
    const next = String(payload.to ?? '');
    if (
      ![
        'queued',
        'running',
        'waiting',
        'completed',
        'failed',
        'cancelled',
      ].includes(next)
    ) {
      throw new BadRequestException(`Invalid execution state: ${next}`);
    }
    execution.status = next as ExecutionStatus;
    if (TERMINAL_STATES.has(next)) {
      execution.completionKind = String(payload.completionKind ?? 'full');
      execution.completionReason = String(
        payload.completionReason ?? 'unknown',
      );
      execution.result = (payload.result as Record<string, unknown>) ?? null;
      execution.error = (payload.error as Record<string, unknown>) ?? null;
    }
  }

  private async validateOperationLifecycle(
    eventRepo: Repository<ExecutionEventEntity>,
    rootExecutionId: string,
    event: Record<string, unknown>,
  ): Promise<void> {
    if (
      !['operation.started', 'operation.finished'].includes(
        String(event.eventType),
      )
    )
      return;
    const operationId = String(event.operationId);
    const attemptId = String(event.attemptId);
    const related = await eventRepo.find({
      where: { rootExecutionId, operationId, attemptId },
    });
    const start = related.find((row) => row.eventType === 'operation.started');
    const finish = related.find(
      (row) => row.eventType === 'operation.finished',
    );
    if (event.eventType === 'operation.started' && start) {
      throw new ConflictException('Operation attempt already started');
    }
    if (event.eventType === 'operation.finished') {
      if (!start)
        throw new BadRequestException('Operation finish has no matching start');
      if (finish)
        throw new ConflictException('Operation attempt already finished');
      const startedPayload = start.envelope.payload as Record<string, unknown>;
      const payload = event.payload as Record<string, unknown>;
      if (startedPayload.operationKind !== payload.operationKind) {
        throw new BadRequestException(
          'Operation kind changed within an attempt',
        );
      }
    }
  }

  private validateStateTransition(
    execution: ExecutionEntity,
    event: Record<string, unknown>,
  ): void {
    if (event.eventType !== 'execution.state_changed') return;
    const payload = event.payload as Record<string, unknown>;
    if (payload.from !== execution.status) {
      throw new ConflictException(
        `Execution state changed from ${execution.status}, not ${String(payload.from)}`,
      );
    }
  }

  private addMissing(execution: ExecutionEntity, item: string): void {
    const missing = new Set(execution.missingEvidence ?? []);
    missing.add(item);
    execution.missingEvidence = [...missing];
    execution.completenessStatus = 'evaluable_partial';
  }
}

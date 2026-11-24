import { claimAvailable } from '../utils/claim-available';
import { forEachSequential } from '../utils/for-each-sequential';
import { readString } from '../utils/read-string';
import { compareStrings } from '../utils/compare-strings';
import { lockExecutionRequest } from './execution-request';
import {
  INFERENCE_EXCHANGE_KIND,
  inferenceCaptureAuthorization,
} from './inference-capture';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ownerPrincipalFromUser } from '../auth/owner-principal';
import { randomUUID } from 'node:crypto';
import { executionTraceContext } from '../telemetry/telemetry';
import {
  DataSource,
  EntityManager,
  In,
  LessThanOrEqual,
  MoreThan,
  Repository,
} from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { ExecutionRequestEntity } from './execution-request.entity';
import { ExecutionEntity } from './execution.entity';
import { ExecutionEventEntity } from './execution-event.entity';
import { ExecutionArtifactEntity } from './execution-artifact.entity';
import {
  IncomingExecutionArtifact,
  ExecutionAccessScope,
  ExecutionCompletion,
} from './execution.types';
import {
  EXECUTION_EVENT_PAYLOADS,
  EXECUTION_BUNDLE_SCHEMA,
  EXECUTION_CONTENT_HASH_PATTERN,
  EXECUTION_CONTRACT_SET_HASH,
  EXECUTION_EVENT_SCHEMA,
  EXECUTION_SCHEMA,
  EXECUTION_UUID_PATTERN,
  isChatTurnTaskType,
} from './execution.constants';
import { CreateExecutionStepInput } from './execution-control-plane.types';
import { ExecutionStepEntity } from './execution-step.entity';
import { ExecutionStepKind } from './execution-step-kind.enum';
import { ExecutionStepStatus } from './execution-step-status.enum';
import { ExecutionStepAttemptEntity } from './execution-step-attempt.entity';
import { createExecutionStep } from './execution-step.service';
import { ExecutionContractValidator } from './execution-contract-validator';
import { ExecutionCompletionValidator } from './execution-completion-validator';
import {
  ChatExecutionAcceptance,
  ChatMessageEntity,
  ExecutionConversationService,
} from './execution-conversation.service';
import { ExecutionPriority } from './execution-priority.enum';
import { EXECUTION_STEP_PRIORITY } from './execution-scheduling-policy';
import { ExecutionStatus } from './execution-status.enum';
import { ExecutionProgressService } from './execution-progress.service';
import { ExecutionResultReceiptEntity } from './execution-result-receipt.entity';
import { ExecutionToolPlanEntity } from './execution-tool-plan.entity';
import {
  ExecutionOutboxEntity,
  ExecutionOutboxStatus,
} from '../execution-outbox/execution-outbox.entity';
import { ExecutionPublication } from '../execution-outbox/execution-publication';
import {
  canonicalHash,
  canonicalDomainHash,
  canonicalProfileValue,
  contentHash,
} from './execution-canonical';
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
  ACTIVE_CONTEXT_ARTIFACT_ROLE,
  freezeActiveContextArtifact,
} from '../conversation/conversation-context';
import { finishSkillActivations } from '../conversation/skill-activation';
import { SkillActivationEntity } from '../conversation/skill-activation.entity';
import { ExecutionArtifactStorageService } from './execution-artifact-storage.service';
import { ExecutionArtifactService } from './execution-artifact.service';
import {
  defaultArtifactExpiry,
  derivedArtifactPolicy,
  earliestArtifactExpiry,
  ExecutionArtifactRetentionClass,
} from './execution-artifact-policy';
import {
  ChatCreationPayloadByKind,
  ExecutionTaskPayload,
  ExecutionTaskType,
  ExecutionTaskWork,
  executionPayloadOwnerId,
  executionTaskWork,
} from './execution-task-payload.types';

import {
  redactExecutionText,
  rejectForbiddenData,
  rejectSensitiveArtifactBody,
} from './execution-data-policy';

export {
  canonicalDomainHash,
  canonicalHash,
  canonicalJson,
  canonicalProfileValue,
  contentHash,
} from './execution-canonical';

const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled']);
const MAX_ARTIFACT_BYTES = 1024 * 1024;

function withFinalizerIdentity<TPayload extends object>(
  payload: TPayload,
  idempotencyKey: string,
): TPayload & { originFinalizerKey: string } {
  return { ...payload, originFinalizerKey: idempotencyKey };
}

export interface CreateExecutionOptions {
  requestId?: string;
  captureInference?: boolean;
  rootExecutionId?: string;
  parentExecutionId?: string;
  childIdempotencyKey?: string;
  ownerPrincipal?: string;
  // A null initial step records an externally driven execution without queue work.
  initialStep?: Omit<CreateExecutionStepInput, 'executionId'> | null;
  steps?: Array<Omit<CreateExecutionStepInput, 'executionId'>>;
  inputArtifacts?: Array<{
    role: string;
    kind: string;
    mediaType: string;
    body: Buffer;
    dataClassification?: string;
    retentionClass?: ExecutionArtifactRetentionClass;
    expiresAt?: Date | null;
    inputSourceIds?: string[];
    derivedFromArtifactIds?: string[];
  }>;
  // Materialize server-derived evidence only for the first accepted request.
  // The request is identified by its explicit input, not by a later snapshot.
  snapshotArtifacts?: (
    manager: EntityManager,
  ) => Promise<NonNullable<CreateExecutionOptions['inputArtifacts']>>;
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

export type { ChatExecutionAcceptance } from './execution-conversation.service';

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

interface ValidatedIncomingEvent extends Record<string, unknown> {
  eventId: string;
  executionId: string;
  eventType: string;
  producer: { component: 'documents-models'; instanceId: string };
  producerSequence: number;
  occurredAt: string;
  operationId?: string | null;
  attemptId?: string | null;
  causedByEventId?: string | null;
  artifactRefs: string[];
  payload: Record<string, unknown>;
}

function bundleArtifactOmission(
  artifact: ExecutionArtifactEntity,
): string | undefined {
  const state = artifact.contentState;
  if (state === 'expired' || state === 'withdrawn') return state;
  return artifact.body ? undefined : 'not_captured';
}

function bundleOperationEvidence(
  events: Record<string, unknown>[],
  missing: Set<string>,
) {
  const starts = new Map<
    string,
    { operationId: string; attemptId: unknown; operationKind: unknown }
  >();
  const finishes = new Set<string>();
  let hasInference = false;
  let hasTool = false;
  for (const event of events) {
    const eventType = readString(event.eventType);
    const operationId = readString(event.operationId);
    const attemptId = readString(event.attemptId);
    const operationKey = `${operationId}:${attemptId}`;
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    if (eventType === 'operation.started') {
      starts.set(operationKey, {
        operationId,
        attemptId: event.attemptId,
        operationKind: payload.operationKind,
      });
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
  for (const [operationKey, { operationId }] of starts) {
    if (!finishes.has(operationKey)) {
      missing.add(`operation.${operationId}.finish`);
    }
  }
  return { starts, hasInference, hasTool };
}

function hasCompleteInferenceExchange(body: Buffer | null): boolean {
  if (!body) return false;
  try {
    const value = JSON.parse(body.toString('utf8'));
    return (
      value.status === 'completed' &&
      typeof value.request?.bodyBase64 === 'string' &&
      typeof value.response?.bodyBase64 === 'string'
    );
  } catch {
    return false;
  }
}

interface FingerprintEvidence {
  fingerprints: Set<string>;
  operations: Set<string>;
}

interface ExecutionStatusUpdateOptions {
  completionKind?: string;
  completionReason?: string;
  cancellationReason?: string;
  publication?: ExecutionPublication;
  phase?: string;
}

function addMissingInferenceExchanges(
  missing: Set<string>,
  starts: Iterable<{
    operationKind: unknown;
    attemptId: unknown;
    operationId: string;
  }>,
  artifacts: ExecutionArtifactEntity[],
): void {
  for (const start of starts) {
    if (start.operationKind !== 'inference') continue;
    const exchanges = artifacts.filter(
      (artifact) =>
        artifact.kind === INFERENCE_EXCHANGE_KIND &&
        artifact.producedByAttemptId === start.attemptId,
    );
    if (
      !exchanges.length ||
      !exchanges.every(({ body }) => hasCompleteInferenceExchange(body))
    ) {
      missing.add(`operation.${start.operationId}.inferenceExchange`);
    }
  }
}

function recordContentFingerprint(
  evidence: FingerprintEvidence,
  operationId: string,
  fingerprint: unknown,
): void {
  if (
    typeof fingerprint === 'string' &&
    EXECUTION_CONTENT_HASH_PATTERN.test(fingerprint)
  ) {
    evidence.fingerprints.add(fingerprint);
    evidence.operations.add(operationId);
  }
}

function recordInferenceMetadata(
  evidence: {
    models: FingerprintEvidence;
    adapters: FingerprintEvidence;
    prompts: FingerprintEvidence;
  },
  operationId: string,
  inference: unknown,
): void {
  if (!inference || typeof inference !== 'object') return;
  const metadata = inference as Record<string, unknown>;
  const model = readString(metadata.effectiveModel);
  if (model && !['unreported', 'not_executed'].includes(model)) {
    evidence.models.fingerprints.add(model);
    evidence.models.operations.add(operationId);
  }
  if (Object.hasOwn(metadata, 'effectiveAdapter')) {
    evidence.adapters.operations.add(operationId);
    const adapter = readString(metadata.effectiveAdapter);
    if (adapter) evidence.adapters.fingerprints.add(adapter);
  }
  const packages = metadata.effectivePromptPackages;
  if (
    Array.isArray(packages) &&
    packages.length > 0 &&
    packages.every(
      (value): value is string => typeof value === 'string' && value.length > 0,
    )
  ) {
    evidence.prompts.operations.add(operationId);
    for (const value of packages) evidence.prompts.fingerprints.add(value);
  }
}

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
    private readonly contractValidator: ExecutionContractValidator,
    private readonly progress: ExecutionProgressService,
    private readonly artifactStorage: ExecutionArtifactStorageService,
    private readonly artifacts: ExecutionArtifactService,
    private readonly completionValidator: ExecutionCompletionValidator,
    private readonly conversations: ExecutionConversationService,
  ) {}

  resolveAccessScope(user: unknown): ExecutionAccessScope {
    return { ownerPrincipal: ownerPrincipalFromUser(user) };
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
    await forEachSequential(turns, async (turn) => {
      await this.updateStatus(
        turn.rootExecutionId,
        ExecutionStatus.CANCELLED,
        undefined,
        {
          cancellationReason: `${ownerType}_deleted`,
          completionReason: `${ownerType}_deleted`,
        },
      );
    });
  }

  async requestCancellation(
    rootExecutionId: string,
    scope: ExecutionAccessScope,
    reason?: string,
  ): Promise<CancellationRequestView> {
    const rawReason = String(reason ?? '').trim() || 'Cancelled by user';
    const cancellationReason = redactExecutionText(rawReason).slice(0, 500);
    const requested = await this.dataSource.transaction((manager) =>
      this.requestCancellationInTransaction(
        manager,
        rootExecutionId,
        scope,
        cancellationReason,
        rawReason,
      ),
    );

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

  private async requestCancellationInTransaction(
    manager: EntityManager,
    rootExecutionId: string,
    scope: ExecutionAccessScope,
    cancellationReason: string,
    rawReason: string,
  ): Promise<ExecutionEntity> {
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
      [ExecutionStatus.COMPLETED, ExecutionStatus.FAILED].includes(root.status)
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

    await forEachSequential(active, async (execution) => {
      const previousPhase = execution.phase;
      execution.cancellationRequestedAt = now;
      execution.cancellationReason = cancellationReason;
      execution.phase = 'cancellation_requested';
      // Until reconciliation changes the status, a waiting row must retain
      // its wait metadata. The cancellation fence prevents resuming it.
      if (execution.status !== ExecutionStatus.WAITING) {
        execution.waitReason = null;
        execution.waitCondition = null;
        execution.resumePhase = null;
        execution.waitExpiresAt = null;
      }
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
    });

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
          ownerPrincipal: root.ownerPrincipal,
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
  }

  async reconcileRequestedCancellations(limit = 20): Promise<number> {
    let reconciled = 0;
    const findCancellation = async (): Promise<string | null> => {
      if (reconciled >= limit) return null;
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
      return readString(rows[0]?.execution_id) || null;
    };
    for await (const executionId of claimAvailable(findCancellation)) {
      const execution = await this.executionRepo.findOneBy({ executionId });
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
      traceContext: executionTraceContext(parent.traceContext),
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
    const contextArtifact = await freezeActiveContextArtifact(
      manager,
      this.artifactStorage,
      {
        rootExecutionId: child.rootExecutionId,
        sessionId: child.sessionId,
        turnId: child.turnId,
        causedByEventId: event.eventId,
        effectivePayload: childPayload,
      },
    );
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
    return await this.dataSource.transaction(async (manager) => {
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
    requestId?: string,
  ): Promise<ChatExecutionAcceptance> {
    return this.conversations.createForChat(
      executionKind,
      message,
      scope,
      payload,
      requestId,
    );
  }

  readChatRequest(
    requestId: string,
    scope: ExecutionAccessScope,
    assistantId: number,
  ) {
    return this.conversations.readChatRequest(requestId, scope, assistantId);
  }

  async create<TTaskType extends ExecutionTaskType>(
    taskType: TTaskType,
    priority: ExecutionPriority,
    payload: ExecutionTaskPayload<TTaskType>,
    options?: CreateExecutionOptions,
  ): Promise<ExecutionEntity> {
    const captureAuthorization = options?.captureInference
      ? inferenceCaptureAuthorization(options.ownerPrincipal)
      : undefined;
    const executionId = randomUUID();
    const rootExecutionId = options?.rootExecutionId ?? executionId;
    return await this.dataSource.transaction(async (manager) => {
      const executionRepo = manager.getRepository(ExecutionEntity);
      const { acceptance, existing } = await this.prepareAcceptedRequest(
        manager,
        taskType,
        priority,
        payload,
        options,
      );
      if (existing) return existing;
      const { eventRoot, parent } = await this.lockCreationTree(
        executionRepo,
        rootExecutionId,
        executionId,
        options,
      );
      const { effectivePayload, existingChild } =
        await this.prepareChildPayload(
          manager,
          taskType,
          payload,
          parent,
          options,
        );
      if (existingChild) return existingChild;
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
        traceContext: executionTraceContext(eventRoot?.traceContext),
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
      const inputArtifacts = [
        ...(options?.inputArtifacts ?? []),
        ...((await options?.snapshotArtifacts?.(manager)) ?? []),
      ];
      const inputArtifactRefs = await Promise.all(
        inputArtifacts.map(async (input) => {
          const artifactId = randomUUID();
          await this.artifactStorage.save(manager, {
            artifactId,
            rootExecutionId,
            kind: input.kind,
            contentHash: contentHash(input.body),
            size: String(input.body.length),
            mediaType: input.mediaType,
            encoding: 'identity',
            dataClassification: input.dataClassification ?? 'workspace',
            redaction: { applied: false },
            retentionClass: input.retentionClass ?? 'operational',
            expiresAt: input.expiresAt,
            createdByEventId: null,
            inputSourceIds: input.inputSourceIds ?? [],
            derivedFromArtifactIds: input.derivedFromArtifactIds ?? [],
            body: input.body,
          });
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
      const steps =
        options?.steps ??
        (options?.initialStep === null
          ? []
          : [
              {
                stepKind: ExecutionStepKind.SERVICE,
                work: executionTaskWork(taskType, effectivePayload),
                requiredCapabilities: [taskType],
                priority: EXECUTION_STEP_PRIORITY[priority],
                ...options?.initialStep,
              },
            ]);
      await forEachSequential(steps.entries(), async ([index, step]) => {
        await createExecutionStep(manager, {
          ...step,
          work:
            captureAuthorization &&
            step.stepKind === ExecutionStepKind.INFERENCE
              ? { ...step.work, inferenceCapture: captureAuthorization }
              : step.work,
          inputArtifactRefs: [
            ...(index === 0 ? inputArtifactRefs : []),
            ...(step.inputArtifactRefs ?? []),
          ],
          executionId,
          causedByEventId: step.causedByEventId ?? executionEvent.eventId,
        });
      });
      const saved = await executionRepo.save(execution);
      if (acceptance) {
        acceptance.executionId = saved.executionId;
        await manager.getRepository(ExecutionRequestEntity).save(acceptance);
      }
      return saved;
    });
  }

  private async prepareAcceptedRequest<TTaskType extends ExecutionTaskType>(
    manager: EntityManager,
    taskType: TTaskType,
    priority: ExecutionPriority,
    payload: ExecutionTaskPayload<TTaskType>,
    options?: CreateExecutionOptions,
  ): Promise<{
    acceptance: ExecutionRequestEntity | null;
    existing: ExecutionEntity | null;
  }> {
    if (options?.requestId === undefined)
      return { acceptance: null, existing: null };
    const executionRepo = manager.getRepository(ExecutionEntity);
    if (
      options.parentExecutionId ||
      options.rootExecutionId ||
      !options.ownerPrincipal
    ) {
      throw new BadRequestException(
        'Request identity requires an owned root execution',
      );
    }
    const acceptance = await lockExecutionRequest(manager, options.requestId, {
      ownerPrincipal: options.ownerPrincipal,
    });
    const requestOptions = { ...options };
    delete requestOptions.snapshotArtifacts;
    const inputHash = canonicalDomainHash({
      taskType,
      priority,
      payload,
      options: requestOptions,
    });
    if (acceptance.inputHash && acceptance.inputHash !== inputHash) {
      throw new ConflictException('execution_request_conflict');
    }
    if (acceptance.executionId) {
      const existing = await executionRepo.findOneBy({
        executionId: acceptance.executionId,
        rootExecutionId: acceptance.executionId,
        ownerPrincipal: options.ownerPrincipal,
      });
      if (!existing)
        throw new ConflictException('execution_request_unavailable');
      return { acceptance, existing };
    }
    if (acceptance.cancelRequested) {
      throw new ConflictException('execution_request_cancelled');
    }
    acceptance.inputHash = inputHash;
    return { acceptance, existing: null };
  }

  private async lockCreationTree(
    executionRepo: Repository<ExecutionEntity>,
    rootExecutionId: string,
    executionId: string,
    options?: CreateExecutionOptions,
  ): Promise<{
    eventRoot: ExecutionEntity | null;
    parent: ExecutionEntity | null;
  }> {
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
    return { eventRoot, parent };
  }

  private async prepareChildPayload<TTaskType extends ExecutionTaskType>(
    manager: EntityManager,
    taskType: TTaskType,
    payload: ExecutionTaskPayload<TTaskType>,
    parent: ExecutionEntity | null,
    options?: CreateExecutionOptions,
  ): Promise<{
    effectivePayload: ExecutionTaskPayload<TTaskType>;
    existingChild: ExecutionEntity | null;
  }> {
    const executionRepo = manager.getRepository(ExecutionEntity);
    const key = options?.childIdempotencyKey;
    if (key === undefined)
      return { effectivePayload: payload, existingChild: null };
    if (!parent || !key || key.length > 160) {
      throw new BadRequestException('invalid_child_idempotency_key');
    }
    const effectivePayload = { ...payload, [FINALIZER_IDEMPOTENCY_FIELD]: key };
    const candidates = await executionRepo.find({
      where: { parentExecutionId: parent.executionId, taskType },
    });
    const matches = candidates.filter(
      (candidate) => candidate.payload?.[FINALIZER_IDEMPOTENCY_FIELD] === key,
    );
    if (matches.length > 1) {
      throw new ConflictException('duplicate_child_idempotency_key');
    }
    const existingChild = matches[0];
    if (!existingChild) return { effectivePayload, existingChild: null };
    if (
      canonicalHash(existingChild.payload) !== canonicalHash(effectivePayload)
    ) {
      throw new ConflictException('child_idempotency_conflict');
    }
    const stepCount = await manager.getRepository(ExecutionStepEntity).countBy({
      executionId: existingChild.executionId,
    });
    if (stepCount !== (options.steps?.length ?? 1)) {
      throw new ConflictException('incomplete_child_execution');
    }
    return { effectivePayload, existingChild };
  }

  async readRequest(requestId: string, scope: ExecutionAccessScope) {
    if (!EXECUTION_UUID_PATTERN.test(requestId))
      throw new BadRequestException('Invalid execution request identity');
    const acceptance = await this.dataSource
      .getRepository(ExecutionRequestEntity)
      .findOneBy({
        ownerPrincipal: scope.ownerPrincipal,
        requestId,
      });
    if (!acceptance) throw new NotFoundException('Execution request not found');
    if (!acceptance.executionId) {
      return {
        requestId,
        cancelRequested: acceptance.cancelRequested,
        executionId: null,
        status: 'cancelled',
        result: null,
        error: null,
      };
    }
    return {
      requestId,
      cancelRequested: acceptance.cancelRequested,
      ...(await this.readOwnedResult(acceptance.executionId, scope)),
    };
  }

  async cancelRequest(requestId: string, scope: ExecutionAccessScope) {
    await this.dataSource.transaction(async (manager) => {
      const acceptance = await lockExecutionRequest(manager, requestId, scope);
      acceptance.cancelRequested = true;
      await manager.getRepository(ExecutionRequestEntity).save(acceptance);
      if (acceptance.executionId) {
        const execution = await manager.getRepository(ExecutionEntity).findOne({
          where: {
            executionId: acceptance.executionId,
            rootExecutionId: acceptance.executionId,
            ownerPrincipal: scope.ownerPrincipal,
          },
          lock: { mode: 'pessimistic_write' },
        });
        if (!execution) throw new NotFoundException('Execution not found');
        if (!TERMINAL_STATES.has(execution.status)) {
          await this.requestCancellationInTransaction(
            manager,
            execution.executionId,
            scope,
            'IA Browser cancelled the inference request',
            'IA Browser cancelled the inference request',
          );
        }
      }
    });
    await this.reconcileRequestedCancellations(100);
    return this.readRequest(requestId, scope);
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
        priority: EXECUTION_STEP_PRIORITY[priority],
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
        priority: EXECUTION_STEP_PRIORITY[priority],
      },
    });
  }

  findOne(executionId: string): Promise<ExecutionEntity | null> {
    return this.executionRepo.findOneBy({ executionId });
  }

  async readOwnedResult(
    rootExecutionId: string,
    scope: ExecutionAccessScope,
  ): Promise<{
    executionId: string;
    status: ExecutionStatus;
    result: unknown;
    error: unknown;
  }> {
    const execution = await this.findOwned(rootExecutionId, scope);
    return {
      executionId: execution.executionId,
      status: execution.status,
      result:
        execution.status === ExecutionStatus.COMPLETED
          ? execution.result
          : null,
      error:
        execution.status === ExecutionStatus.FAILED ? execution.error : null,
    };
  }

  claimReadyForFinalization(): Promise<ExecutionEntity | null> {
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

  recoverStaleFinalizations(staleBefore: Date): Promise<number> {
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
    await forEachSequential(pending, async (execution) => {
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
    });
    return finalized;
  }

  private defaultCompletionReason(status: ExecutionStatus): string {
    switch (status) {
      case ExecutionStatus.FAILED:
        return 'processor_failed';
      case ExecutionStatus.CANCELLED:
        return 'cancelled';
      default:
        return 'backend_finalized';
    }
  }

  updateStatus(
    executionId: string,
    status: ExecutionStatus,
    failureMessage?: string,
    options?: ExecutionStatusUpdateOptions,
    manager?: EntityManager,
  ): Promise<ExecutionEntity | null> {
    const transition = async (manager: EntityManager) => {
      const executionRepo = manager.getRepository(ExecutionEntity);
      const eventRepo = manager.getRepository(ExecutionEventEntity);
      const execution = await executionRepo.findOne({
        where: { executionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!execution) return null;
      if (
        execution.status === status &&
        (options?.phase === undefined || options.phase === execution.phase)
      )
        return execution;

      const root = await this.lockExecutionRoot(executionRepo, execution);

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
      if (options?.phase !== undefined) execution.phase = options.phase;
      const terminal = TERMINAL_STATES.has(status);
      let conversationMessage: ChatMessageEntity | null = null;
      if (terminal) {
        this.applyTerminalStatus(execution, status, failureMessage, options);
        conversationMessage = await this.finishTerminalConversation(
          manager,
          execution,
          status,
          failureMessage,
          options?.publication,
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
            phase: execution.phase ?? undefined,
            ...(terminal
              ? {
                  completionKind: execution.completionKind,
                  completionReason: execution.completionReason,
                  result: execution.result,
                  error: execution.error,
                }
              : {}),
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
      if (terminal) {
        await this.appendTerminalPublication(
          manager,
          execution,
          stateEvent.eventId,
          options?.publication ??
            this.conversations.chatPublication(execution, conversationMessage),
        );
      }
      return execution;
    };
    return manager
      ? transition(manager)
      : this.dataSource.transaction(transition);
  }

  private async lockExecutionRoot(
    repository: Repository<ExecutionEntity>,
    execution: ExecutionEntity,
  ): Promise<ExecutionEntity> {
    if (execution.rootExecutionId === execution.executionId) return execution;
    const root = await repository.findOne({
      where: {
        executionId: execution.rootExecutionId,
        rootExecutionId: execution.rootExecutionId,
      },
      lock: { mode: 'pessimistic_write' },
    });
    if (!root) throw new NotFoundException('Root execution not found');
    return root;
  }

  private applyTerminalStatus(
    execution: ExecutionEntity,
    status: ExecutionStatus,
    failureMessage?: string,
    options?: ExecutionStatusUpdateOptions,
  ): void {
    execution.completedAt = new Date();
    execution.phase = null;
    execution.completionKind = options?.completionKind ?? 'full';
    execution.completionReason =
      options?.completionReason ?? this.defaultCompletionReason(status);
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

  private async finishTerminalConversation(
    manager: EntityManager,
    execution: ExecutionEntity,
    status: ExecutionStatus,
    failureMessage: string | undefined,
    publication?: ExecutionPublication,
  ): Promise<ChatMessageEntity | null> {
    await finishSkillActivations(manager, execution.executionId, status);
    let turnStatus:
      | ConversationTurnStatus.COMPLETED
      | ConversationTurnStatus.FAILED
      | ConversationTurnStatus.CANCELLED;
    if (status === ExecutionStatus.COMPLETED) {
      turnStatus = ConversationTurnStatus.COMPLETED;
    } else if (status === ExecutionStatus.CANCELLED) {
      turnStatus = ConversationTurnStatus.CANCELLED;
    } else {
      turnStatus = ConversationTurnStatus.FAILED;
    }
    // A chat turn that fails without going through its processor finalizer
    // (worker_failed, missing processor, finalization error) still owes the
    // user an answer: without a persisted reply the client keeps the turn
    // pending forever, since `chatPublication` is built from a message.
    const failureResponse =
      status === ExecutionStatus.FAILED &&
      isChatTurnTaskType(execution.taskType) &&
      !publication
        ? {
            reply: '',
            error: redactExecutionText(
              failureMessage ??
                readString(
                  (execution.error as Record<string, unknown> | null)?.message,
                  'The assistant could not complete the request',
                ),
            ),
          }
        : undefined;
    return this.conversations.finishConversationTurn(
      manager,
      execution,
      turnStatus,
      failureResponse,
    );
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
        ownerPrincipal: execution.ownerPrincipal,
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
    return await this.dataSource.transaction(async (manager) => {
      const execution = await manager.getRepository(ExecutionEntity).findOne({
        where: { executionId: rootExecutionId, rootExecutionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!execution) throw new NotFoundException('Execution not found');
      let accepted = 0;
      let duplicates = 0;
      await forEachSequential(artifacts, async (input) => {
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
          return;
        }
        const body = this.decodeIncomingArtifact(input);
        await this.artifactStorage.save(manager, {
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
          expiresAt:
            typeof input.expiresAt === 'string'
              ? new Date(input.expiresAt)
              : input.expiresAt,
          createdByEventId: input.createdByEventId ?? null,
          inputSourceIds: input.inputSourceIds ?? [],
          derivedFromArtifactIds: input.derivedFromArtifactIds ?? [],
          body,
        });
        if (!body)
          this.addMissing(execution, `artifact_body:${input.artifactId}`);
        accepted += 1;
      });
      await manager.save(execution);
      return { accepted, duplicates };
    });
  }

  private decodeIncomingArtifact(
    input: IncomingExecutionArtifact,
  ): Buffer | null {
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
      (body.length !== input.size || contentHash(body) !== input.contentHash)
    ) {
      throw new BadRequestException(
        `Artifact integrity mismatch: ${input.artifactId}`,
      );
    }
    if (body !== null) rejectSensitiveArtifactBody(input, body);
    return body;
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
    return await this.dataSource.transaction(async (manager) => {
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
      await forEachSequential(events, async (incoming) => {
        this.validateIncomingEvent(execution, incoming);
        const targetExecution =
          incoming.executionId === execution.executionId
            ? execution
            : await executionRepo.findOne({
                where: {
                  executionId: incoming.executionId,
                  rootExecutionId,
                },
                lock: { mode: 'pessimistic_write' },
              });
        if (!targetExecution) {
          throw new BadRequestException(
            `Unknown execution in root: ${incoming.executionId}`,
          );
        }
        const { eventId, producer, producerSequence } = incoming;
        const duplicate = await eventRepo.findOne({ where: { eventId } });
        if (duplicate) {
          if (duplicate.rootExecutionId !== rootExecutionId) {
            throw new ConflictException(`Event identity conflict: ${eventId}`);
          }
          duplicates += 1;
          return;
        }
        if (TERMINAL_STATES.has(execution.status)) {
          throw new ConflictException(
            'A terminal execution cannot accept new events',
          );
        }
        await this.assertProducerSequence(
          eventRepo,
          rootExecutionId,
          producer,
          producerSequence,
        );
        const cause = incoming.causedByEventId;
        await this.assertEventReferences(
          manager,
          eventRepo,
          rootExecutionId,
          cause,
          incoming.artifactRefs,
        );
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
        const profiled = canonicalProfileValue(envelope) as Record<
          string,
          unknown
        >;
        const withHash = { ...profiled, contentHash: canonicalHash(profiled) };
        const row = eventRepo.create({
          eventId,
          rootExecutionId,
          sequence: String(sequence),
          producerComponent: producer.component,
          producerInstanceId: producer.instanceId,
          producerSequence: String(producerSequence),
          eventType: incoming.eventType,
          executionId: incoming.executionId,
          operationId: incoming.operationId ?? null,
          attemptId: incoming.attemptId ?? null,
          causedByEventId: cause ?? null,
          occurredAt: new Date(incoming.occurredAt),
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
      });
      execution.lastSequence = String(sequence);
      await this.progress.refreshProjection(eventRepo, execution);
      await executionRepo.save(execution);
      return { accepted, duplicates, lastSequence: sequence };
    });
  }

  private async assertProducerSequence(
    eventRepo: Repository<ExecutionEventEntity>,
    rootExecutionId: string,
    producer: { component: string; instanceId: string },
    producerSequence: number,
  ): Promise<void> {
    const occupied = await eventRepo.findOne({
      where: {
        rootExecutionId,
        producerComponent: producer.component,
        producerInstanceId: producer.instanceId,
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
        producerComponent: producer.component,
        producerInstanceId: producer.instanceId,
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
  }

  private async assertEventReferences(
    manager: EntityManager,
    eventRepo: Repository<ExecutionEventEntity>,
    rootExecutionId: string,
    cause: string | undefined,
    artifactRefs: string[],
  ): Promise<void> {
    if (cause) {
      const knownCause = await eventRepo.findOne({
        where: { eventId: cause, rootExecutionId },
      });
      if (!knownCause) {
        throw new BadRequestException(`Unknown causal event: ${cause}`);
      }
    }
    if (artifactRefs.length > 0) {
      const artifacts = await manager
        .getRepository(ExecutionArtifactEntity)
        .findBy({ artifactId: In(artifactRefs), rootExecutionId });
      const found = new Set(
        artifacts.map((artifact) => artifact.artifactId.toLowerCase()),
      );
      const missing = artifactRefs.find((id) => !found.has(id.toLowerCase()));
      if (missing) {
        throw new BadRequestException(`Unknown artifact reference: ${missing}`);
      }
    }
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
      const root = await this.lockExecutionRoot(executionRepo, execution);
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
      this.completionValidator.validate({
        execution,
        events: rows,
        artifacts,
        safeReply: redactExecutionText(reply),
        error,
        completion,
      });
      const conversationMessage =
        await this.conversations.finishConversationTurn(
          manager,
          execution,
          error
            ? ConversationTurnStatus.FAILED
            : ConversationTurnStatus.COMPLETED,
          { reply: redactExecutionText(reply), error },
        );
      const resolvedPublication =
        publication ??
        this.conversations.chatPublication(execution, conversationMessage);
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
      if (!hasFinalMessage && reply && !TERMINAL_STATES.has(execution.status)) {
        const message = await this.appendFinalResponse(
          manager,
          root,
          execution,
          rows,
          {
            reply,
            generationSource: completion?.source,
            causedByEventId: lastEventId,
            sequence: ++sequence,
            producerSequence: ++nextProducerSequence,
          },
        );
        lastEventId = message.eventId;
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
        const outcome = this.chatCompletionOutcome(
          execution,
          reply,
          error,
          completion,
        );
        const stateEvent = await this.appendBackendEvent(
          manager,
          root,
          ++nextProducerSequence,
          {
            eventType: 'execution.state_changed',
            payloadSchema: 'execution.state_changed/1',
            payload: {
              from: execution.status,
              to: outcome.status,
              completionKind: outcome.completionKind,
              completionReason: outcome.completionReason,
              ...(completion?.source
                ? { completionSource: completion.source }
                : {}),
              ...(completion?.partialResult
                ? { partialResult: completion.partialResult }
                : {}),
              result: outcome.result,
              error: outcome.error,
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
        Object.assign(execution, outcome);
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

  private async appendFinalResponse(
    manager: EntityManager,
    root: ExecutionEntity,
    execution: ExecutionEntity,
    rows: ExecutionEventEntity[],
    input: {
      reply: string;
      generationSource?: ExecutionCompletion['source'];
      causedByEventId: string | null;
      sequence: number;
      producerSequence: number;
    },
  ): Promise<ExecutionEventEntity> {
    const {
      reply,
      generationSource,
      causedByEventId,
      sequence,
      producerSequence,
    } = input;
    const observedSourceIds = rows.flatMap((row) => {
      if (row.eventType !== 'source.observed') return [];
      const sourceId = (row.envelope.payload as Record<string, unknown>)
        ?.sourceId;
      return typeof sourceId === 'string' ? [sourceId] : [];
    });
    const dependencyArtifactIds = [
      ...new Set(rows.flatMap((row) => row.envelope.artifactRefs ?? [])),
    ];
    const dependencyArtifacts = dependencyArtifactIds.length
      ? await manager.getRepository(ExecutionArtifactEntity).findBy({
          rootExecutionId: execution.rootExecutionId,
          artifactId: In(dependencyArtifactIds),
        })
      : [];
    const finalArtifactPolicy = derivedArtifactPolicy(dependencyArtifacts);

    const artifactId = randomUUID();
    const safeReply = redactExecutionText(reply);
    const body = Buffer.from(safeReply, 'utf8');
    await this.artifactStorage.save(manager, {
      artifactId,
      rootExecutionId: execution.rootExecutionId,
      kind: 'model_response',
      contentHash: contentHash(body),
      size: String(body.length),
      mediaType: 'text/plain',
      encoding: 'identity',
      dataClassification: finalArtifactPolicy.dataClassification,
      redaction: { applied: safeReply !== reply },
      retentionClass: finalArtifactPolicy.retentionClass,
      expiresAt: finalArtifactPolicy.expiresAt,
      createdByEventId: null,
      inputSourceIds: [
        ...new Set([
          ...observedSourceIds,
          ...finalArtifactPolicy.inputSourceIds,
        ]),
      ],
      derivedFromArtifactIds: finalArtifactPolicy.derivedFromArtifactIds,
      body,
    });
    return this.appendBackendEvent(
      manager,
      root,
      producerSequence,
      {
        eventType: 'message.recorded',
        payloadSchema: 'message.recorded/1',
        payload: {
          messageKind: 'final_response',
          role: 'assistant',
          contentPreview: safeReply.slice(0, 512),
          contentArtifactId: artifactId,
          format: 'text',
          ...(generationSource ? { generationSource } : {}),
        },
        actor: { type: 'system' },
        executionId: execution.executionId,
        turnId: execution.turnId,
        causedByEventId,
        artifactRefs: [artifactId],
        redactionApplied: safeReply !== reply,
      },
      sequence,
    );
  }

  private chatCompletionOutcome(
    execution: ExecutionEntity,
    reply: string,
    error: string | null,
    completion?: ExecutionCompletion,
  ): Pick<
    ExecutionEntity,
    'status' | 'completionKind' | 'completionReason' | 'result' | 'error'
  > {
    const completionKind = completion?.kind ?? 'full';
    const completionReason =
      completion?.reason ?? (error ? 'model_or_tool_failed' : 'goal_satisfied');
    if (error) {
      return {
        status: ExecutionStatus.FAILED,
        completionKind,
        completionReason,
        result: null,
        error: {
          code:
            completionReason === 'partial_loop_guard'
              ? 'IMMEDIATE_EXACT_TOOL_REPEAT_PERSISTED'
              : 'CHAT_FAILED',
          message: redactExecutionText(error),
        },
      };
    }
    const previous =
      execution.result && typeof execution.result === 'object'
        ? execution.result
        : {};
    return {
      status: ExecutionStatus.COMPLETED,
      completionKind,
      completionReason,
      result: { ...previous, reply: redactExecutionText(reply) },
      error: null,
    };
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
    this.completionValidator.validate({
      execution,
      events: rows,
      artifacts,
      safeReply: redactExecutionText(reply),
      error,
      completion,
    });
  }

  private async loadArtifactsWithBody(
    repository: Repository<ExecutionArtifactEntity>,
    rootExecutionId: string,
  ): Promise<ExecutionArtifactEntity[]> {
    const artifacts = await repository
      .createQueryBuilder('artifact')
      .addSelect('artifact.body')
      .where('artifact.root_execution_id = :rootExecutionId', {
        rootExecutionId,
      })
      .getMany();
    return this.artifactStorage.hydrateAll(artifacts);
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
    const exportedAt = new Date();
    await this.purgeAllExpiredArtifacts(1_000, exportedAt);
    const execution = await this.findOwned(rootExecutionId, scope);
    const events = (
      await this.eventRepo.find({
        where: { rootExecutionId },
        order: { sequence: 'ASC' },
      })
    ).map((row) => row.envelope);
    const storedArtifacts = await this.artifactRepo
      .createQueryBuilder('artifact')
      .addSelect('artifact.body')
      .where('artifact.root_execution_id = :rootExecutionId', {
        rootExecutionId,
      })
      .orderBy('artifact.created_at', 'ASC')
      .getMany();
    const artifacts = await this.artifactStorage.hydrateAll(storedArtifacts);
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
      if (artifact.contentState === 'active' && artifact.body) {
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
        storageRef:
          artifact.contentState === 'active' ? artifact.storageRef : undefined,
        createdByEventId: artifact.createdByEventId ?? undefined,
        inputSourceIds: artifact.inputSourceIds,
        derivedFromArtifactIds: artifact.derivedFromArtifactIds,
        dataClassification: artifact.dataClassification,
        redaction: artifact.redaction,
        retentionClass: 'evaluation',
        expiresAt: artifact.expiresAt?.toISOString(),
        contentState: artifact.contentState,
        contentDeletedAt: artifact.contentDeletedAt?.toISOString(),
        withdrawalReason: artifact.withdrawalReason ?? undefined,
        omissionReason: bundleArtifactOmission(artifact),
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
      { ...inferenceIdentities, ...toolIdentities },
    );
    const completenessStatus = missingEvidence.length
      ? 'evaluable_partial'
      : execution.completenessStatus;
    const policyExpiresAt = earliestArtifactExpiry([
      defaultArtifactExpiry('evaluation', exportedAt),
      ...artifacts
        .filter((artifact) => artifact.contentState === 'active')
        .map((artifact) => artifact.expiresAt),
    ])!;
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
        expiresAt: policyExpiresAt.toISOString(),
        accessScope: scope,
      },
      exportedAt: exportedAt.toISOString(),
    };
    bundle.manifestHash = canonicalHash(bundle);
    this.contractValidator.assertBundle(bundle);
    return bundle;
  }

  async withdrawArtifact(
    rootExecutionId: string,
    artifactId: string,
    scope: ExecutionAccessScope,
    reason: string,
  ): Promise<{ artifactIds: string[]; state: 'withdrawn' }> {
    await this.findOwned(rootExecutionId, scope);
    const artifactIds = await this.dataSource.transaction(async (manager) => {
      const root = await this.lockOwnedRoot(manager, rootExecutionId, scope);
      const artifact = await manager
        .getRepository(ExecutionArtifactEntity)
        .findOneBy({ artifactId, rootExecutionId });
      if (!artifact) throw new NotFoundException('artifact_not_found');
      if (artifact.contentState === 'withdrawn') {
        return this.artifacts.derivedArtifactClosure(manager, rootExecutionId, [
          artifactId,
        ]);
      }
      const affected = await this.artifacts.retireGraph(
        manager,
        rootExecutionId,
        [artifactId],
        'withdrawn',
        reason.trim(),
        new Date(),
      );
      await this.appendEvidenceLifecycleEvent(manager, root, {
        eventType: 'artifact.withdrawn',
        payloadSchema: 'artifact.withdrawn/1',
        payload: {
          artifactId,
          reason: reason.trim(),
          propagatedArtifactIds: affected.filter((id) => id !== artifactId),
        },
        artifactId,
        artifactRefs: affected,
      });
      return affected;
    });
    await this.cancelActiveExecutionAfterEvidenceLoss(rootExecutionId, scope);
    return { artifactIds, state: 'withdrawn' };
  }

  async withdrawSource(
    rootExecutionId: string,
    sourceId: string,
    scope: ExecutionAccessScope,
    reason: string,
  ): Promise<{ sourceId: string; artifactIds: string[]; state: 'withdrawn' }> {
    await this.findOwned(rootExecutionId, scope);
    const artifactIds = await this.dataSource.transaction(async (manager) => {
      const root = await this.lockOwnedRoot(manager, rootExecutionId, scope);
      const events = await manager.getRepository(ExecutionEventEntity).find({
        where: { rootExecutionId },
        order: { sequence: 'ASC' },
      });
      const observed = events.find(
        (event) =>
          event.eventType === 'source.observed' &&
          (event.envelope.payload as Record<string, unknown>)?.sourceId ===
            sourceId,
      );
      if (!observed) throw new NotFoundException('source_not_found');
      const existing = events.some(
        (event) =>
          event.eventType === 'source.withdrawn' &&
          (event.envelope.payload as Record<string, unknown>)?.sourceId ===
            sourceId,
      );
      if (existing) {
        return this.artifacts.derivedArtifactClosure(
          manager,
          rootExecutionId,
          await this.artifacts.findIdsForSource(
            manager,
            rootExecutionId,
            sourceId,
          ),
        );
      }
      const direct = await this.artifacts.findIdsForSource(
        manager,
        rootExecutionId,
        sourceId,
      );
      const affected = await this.artifacts.retireGraph(
        manager,
        rootExecutionId,
        direct,
        'withdrawn',
        reason.trim(),
        new Date(),
      );
      await this.appendEvidenceLifecycleEvent(manager, root, {
        eventType: 'source.withdrawn',
        payloadSchema: 'source.withdrawn/1',
        payload: {
          sourceId,
          reason: reason.trim(),
          affectedArtifactIds: affected,
        },
        sourceId,
        causedByEventId: observed.eventId,
        artifactRefs: affected,
      });
      return affected;
    });
    await this.cancelActiveExecutionAfterEvidenceLoss(rootExecutionId, scope);
    return { sourceId, artifactIds, state: 'withdrawn' };
  }

  async purgeAllExpiredArtifacts(limit: number, now?: Date): Promise<void> {
    const purgeBatch = () => this.purgeExpiredArtifacts(limit, now);
    for await (const purged of claimAvailable(purgeBatch)) {
      if (purged <= 0) return;
    }
  }

  async purgeExpiredArtifacts(limit = 100, now = new Date()): Promise<number> {
    const expired = await this.artifactRepo.find({
      where: {
        contentState: 'active',
        expiresAt: LessThanOrEqual(now),
      },
      order: { expiresAt: 'ASC' },
      take: limit,
    });
    const byRoot = new Map<string, string[]>();
    for (const artifact of expired) {
      const ids = byRoot.get(artifact.rootExecutionId) ?? [];
      ids.push(artifact.artifactId);
      byRoot.set(artifact.rootExecutionId, ids);
    }
    let purged = 0;
    await forEachSequential(byRoot, async ([rootExecutionId, artifactIds]) => {
      const result = await this.dataSource.transaction(async (manager) => {
        const root = await manager.getRepository(ExecutionEntity).findOne({
          where: { executionId: rootExecutionId, rootExecutionId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!root) return { count: 0, ownerPrincipal: null };
        const affected = await this.artifacts.retireGraph(
          manager,
          rootExecutionId,
          artifactIds,
          'expired',
          'retention_expired',
          now,
        );
        if (!affected.length) {
          return { count: 0, ownerPrincipal: root.ownerPrincipal };
        }
        await this.appendEvidenceLifecycleEvent(manager, root, {
          eventType: 'artifact.expired',
          payloadSchema: 'artifact.expired/1',
          payload: {
            artifactIds,
            propagatedArtifactIds: affected.filter(
              (id) => !artifactIds.includes(id),
            ),
          },
          artifactRefs: affected,
        });
        return {
          count: affected.length,
          ownerPrincipal: root.ownerPrincipal,
        };
      });
      purged += result.count;
      if (result.count && result.ownerPrincipal) {
        await this.cancelActiveExecutionAfterEvidenceLoss(rootExecutionId, {
          ownerPrincipal: result.ownerPrincipal,
        });
      }
    });
    return purged;
  }

  private async lockOwnedRoot(
    manager: EntityManager,
    rootExecutionId: string,
    scope: ExecutionAccessScope,
  ): Promise<ExecutionEntity> {
    const root = await manager.getRepository(ExecutionEntity).findOne({
      where: {
        executionId: rootExecutionId,
        rootExecutionId,
        ownerPrincipal: scope.ownerPrincipal,
      },
      lock: { mode: 'pessimistic_write' },
    });
    if (!root) throw new NotFoundException('Execution not found');
    return root;
  }

  private async appendEvidenceLifecycleEvent(
    manager: EntityManager,
    root: ExecutionEntity,
    input: {
      eventType: string;
      payloadSchema: string;
      payload: Record<string, unknown>;
      artifactId?: string;
      sourceId?: string;
      causedByEventId?: string;
      artifactRefs: string[];
    },
  ): Promise<void> {
    const events = await manager.getRepository(ExecutionEventEntity).find({
      where: { rootExecutionId: root.rootExecutionId },
      order: { sequence: 'ASC' },
    });
    const event = await this.appendBackendEvent(
      manager,
      root,
      nextBackendProducerSequence(events),
      {
        ...input,
        actor: { type: 'system' },
        executionId: root.executionId,
        causedByEventId: input.causedByEventId ?? root.lastEventId,
      },
      Number(root.lastSequence) + 1,
    );
    root.lastSequence = event.sequence;
    root.lastEventId = event.eventId;
    await manager.save(root);
  }

  private async cancelActiveExecutionAfterEvidenceLoss(
    rootExecutionId: string,
    scope: ExecutionAccessScope,
  ): Promise<void> {
    const root = await this.executionRepo.findOneBy({
      executionId: rootExecutionId,
      rootExecutionId,
    });
    if (root && !TERMINAL_STATES.has(root.status)) {
      await this.requestCancellation(
        rootExecutionId,
        scope,
        'Required evidence became unavailable',
      );
    }
  }

  private deriveBundleMissingEvidence(
    execution: ExecutionEntity,
    events: Record<string, unknown>[],
    artifacts: ExecutionArtifactEntity[],
    inferenceIdentities: {
      modelIdentityKnown: boolean;
      adapterIdentityKnown: boolean;
      promptIdentityKnown: boolean;
      codeIdentityKnown: boolean;
      toolIdentityKnown: boolean;
      runtimeIdentityKnown: boolean;
    },
  ): string[] {
    const missing = new Set(execution.missingEvidence ?? []);

    const { starts, hasInference, hasTool } = bundleOperationEvidence(
      events,
      missing,
    );
    if (hasInference) {
      addMissingInferenceExchanges(missing, starts.values(), artifacts);
      // Request/response capture alone does not establish the identity of the
      // served model, engine and template needed to replay an inference.
      missing.add('environment.servedInferenceIdentity');
      const identities = [
        [inferenceIdentities.codeIdentityKnown, 'codeFingerprints'],
        [inferenceIdentities.modelIdentityKnown, 'modelFingerprints'],
        [inferenceIdentities.adapterIdentityKnown, 'adapterFingerprints'],
        [inferenceIdentities.promptIdentityKnown, 'promptPackages'],
      ] as const;
      for (const [known, field] of identities) {
        if (!known) missing.add(`environment.${field}`);
      }
    }
    if (hasTool && !inferenceIdentities.toolIdentityKnown) {
      missing.add('environment.toolVersions');
    }
    if (!inferenceIdentities.runtimeIdentityKnown) {
      missing.add('environment.runtimeFingerprints');
    }
    for (const artifact of artifacts) {
      if (artifact.body !== null) continue;
      const state = artifact.contentState;
      const reason =
        state === 'expired' || state === 'withdrawn' ? state : 'body';
      missing.add(`artifact.${artifact.artifactId}.${reason}`);
    }
    return [...missing].sort(compareStrings);
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
        .map((event) => readString(event.operationId)),
    );
    const executionIds = [
      ...new Set(events.map((event) => readString(event.executionId))),
    ].filter(Boolean);
    const operationIds = new Set(
      events
        .filter((event) => event.eventType === 'operation.started')
        .map((event) => readString(event.operationId)),
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
        runtimeFingerprints: [...runtimeFingerprints].sort(compareStrings),
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
    const evidence = {
      models: {
        fingerprints: new Set<string>(),
        operations: new Set<string>(),
      },
      adapters: {
        fingerprints: new Set<string>(),
        operations: new Set<string>(),
      },
      prompts: {
        fingerprints: new Set<string>(),
        operations: new Set<string>(),
      },
      code: { fingerprints: new Set<string>(), operations: new Set<string>() },
      runtime: {
        fingerprints: runtimeFingerprints,
        operations: new Set<string>(),
      },
    };
    for (const receipt of receipts) {
      if (!operationIds.has(receipt.operationId)) continue;
      recordContentFingerprint(
        evidence.runtime,
        receipt.operationId,
        receipt.result?.runtimeFingerprint,
      );
      if (!inferenceOperationIds.has(receipt.operationId)) continue;
      recordContentFingerprint(
        evidence.code,
        receipt.operationId,
        receipt.result?.codeFingerprint,
      );
      recordInferenceMetadata(
        evidence,
        receipt.operationId,
        receipt.result?.inference,
      );
    }
    const coversEveryInference = (covered: Set<string>) =>
      [...inferenceOperationIds].every((operationId) =>
        covered.has(operationId),
      );
    return {
      modelFingerprints: [...evidence.models.fingerprints].sort(compareStrings),
      adapterFingerprints: [...evidence.adapters.fingerprints].sort(
        compareStrings,
      ),
      promptPackages: [...evidence.prompts.fingerprints].sort(compareStrings),
      codeFingerprints: [...evidence.code.fingerprints].sort(compareStrings),
      runtimeFingerprints: [...runtimeFingerprints].sort(compareStrings),
      modelIdentityKnown: coversEveryInference(evidence.models.operations),
      adapterIdentityKnown: coversEveryInference(evidence.adapters.operations),
      promptIdentityKnown: coversEveryInference(evidence.prompts.operations),
      codeIdentityKnown: coversEveryInference(evidence.code.operations),
      runtimeIdentityKnown: [...operationIds].every((id) =>
        evidence.runtime.operations.has(id),
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
        .map((event) => readString(event.operationId)),
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
      toolVersions: [...versions].sort(compareStrings),
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
  ): asserts event is ValidatedIncomingEvent {
    rejectForbiddenData(event);
    for (const field of ['eventId', 'rootExecutionId', 'executionId']) {
      const value = event[field];
      if (typeof value !== 'string' || !EXECUTION_UUID_PATTERN.test(value)) {
        throw new BadRequestException(`${field} must be a UUID`);
      }
    }
    if (event.rootExecutionId !== execution.rootExecutionId) {
      throw new BadRequestException(
        'Event identity is outside execution scope',
      );
    }
    const eventType =
      typeof event.eventType === 'string' ? event.eventType : '';
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
      typeof producerRecord.instanceId !== 'string' ||
      !producerRecord.instanceId.trim()
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
    if (
      typeof event.occurredAt !== 'string' ||
      Number.isNaN(Date.parse(event.occurredAt))
    ) {
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
    if (
      artifact.expiresAt !== undefined &&
      artifact.expiresAt !== null &&
      (Number.isNaN(new Date(artifact.expiresAt).getTime()) ||
        new Date(artifact.expiresAt) <= new Date())
    ) {
      throw new BadRequestException('artifact_expiry_invalid');
    }
    for (const ids of [
      artifact.inputSourceIds ?? [],
      artifact.derivedFromArtifactIds ?? [],
    ]) {
      if (
        !Array.isArray(ids) ||
        ids.some(
          (id) => typeof id !== 'string' || !EXECUTION_UUID_PATTERN.test(id),
        )
      ) {
        throw new BadRequestException('artifact_provenance_invalid');
      }
    }
    this.contractValidator.assertArtifact({
      ...artifact,
      storageRef: `execution:pending:artifact:${artifact.artifactId}`,
      encoding: artifact.encoding ?? 'identity',
      redaction: artifact.redaction ?? { applied: false },
      retentionClass: artifact.retentionClass ?? 'evaluation',
    });
  }

  private materializeState(
    execution: ExecutionEntity,
    event: ValidatedIncomingEvent,
  ): void {
    if (event.eventType !== 'execution.state_changed') return;
    const { payload } = event;
    const next = typeof payload.to === 'string' ? payload.to : '';
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
      execution.completionKind =
        typeof payload.completionKind === 'string'
          ? payload.completionKind
          : 'full';
      execution.completionReason =
        typeof payload.completionReason === 'string'
          ? payload.completionReason
          : 'unknown';
      execution.result = (payload.result as Record<string, unknown>) ?? null;
      execution.error = (payload.error as Record<string, unknown>) ?? null;
    }
  }

  private async validateOperationLifecycle(
    eventRepo: Repository<ExecutionEventEntity>,
    rootExecutionId: string,
    event: ValidatedIncomingEvent,
  ): Promise<void> {
    if (
      event.eventType !== 'operation.started' &&
      event.eventType !== 'operation.finished'
    )
      return;
    const { operationId, attemptId } = event;
    if (!operationId || !attemptId) {
      throw new BadRequestException('Operation and attempt ids are required');
    }
    const related = await eventRepo.find({
      where: { rootExecutionId, operationId, attemptId },
    });
    const start = related.find((row) => row.eventType === 'operation.started');
    const finish = related.some(
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
      if (startedPayload.operationKind !== event.payload.operationKind) {
        throw new BadRequestException(
          'Operation kind changed within an attempt',
        );
      }
    }
  }

  private validateStateTransition(
    execution: ExecutionEntity,
    event: ValidatedIncomingEvent,
  ): void {
    if (event.eventType !== 'execution.state_changed') return;
    const from =
      typeof event.payload.from === 'string' ? event.payload.from : '';
    if (from !== execution.status) {
      throw new ConflictException(
        `Execution state changed from ${execution.status}, not ${from}`,
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

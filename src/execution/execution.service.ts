import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import { DataSource, EntityManager, MoreThan, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { ExecutionEntity } from './execution.entity';
import { ExecutionEventEntity } from './execution-event.entity';
import { ExecutionArtifactEntity } from './execution-artifact.entity';
import {
  IncomingExecutionArtifact,
  ExecutionTelemetrySummary,
  ExecutionAccessScope,
  ExecutionCompletion,
  DeterministicPartialResult,
  OperationBudgetReservationRequest,
  ProgressGrantRequest,
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
import { ExecutionStepKind } from './execution-step-kind.enum';
import { ExecutionStepEntity } from './execution-step.entity';
import { ExecutionStepAttemptEntity } from './execution-step-attempt.entity';
import { ExecutionStepAttemptStatus } from './execution-step-attempt-status.enum';
import { createExecutionStep } from './execution-step.service';
import {
  exactToolRepeatBlockSignal,
  exactToolRepeatTerminateSignal,
  exactToolRepeatWarningSignal,
} from './exact-tool-repeat-guard';
import { ExecutionContractValidator } from './execution-contract-validator';
import { ExecutionPriority } from './execution-priority.enum';
import { ExecutionStatus } from './execution-status.enum';
import {
  BudgetSoftLimitSignal,
  ExactToolRepeatGuardState,
  ExactToolRepeatSignal,
  OperationBudgetGrant,
  OperationBudgetReservation,
  OperationBudgetSnapshot,
  ProgressEvent,
  exactToolRepeatGuardSnapshot,
  projectExecutionProgress,
} from './execution-progress';
import {
  assertBucketMatchesOperation,
  assertGrantScope,
  assertOperationBudgetProjection,
  assertReservationMatches,
  assertReservationScope,
  createOperationBudgetGrant,
  createOperationBudgetReservation,
  governedBudgetStart,
  resolveEffectivePolicy,
  validateProgressGrantRequest,
  validateReservationRequest,
  withoutGrantUsage,
} from './inference-budget-policy';

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

const STEP_PRIORITY: Record<ExecutionPriority, number> = {
  [ExecutionPriority.HIGH]: 100,
  [ExecutionPriority.NORMAL]: 0,
  [ExecutionPriority.BACKGROUND]: -100,
};

function operationBudgetSnapshot(
  grant: OperationBudgetGrant & {
    usage: {
      normal: OperationBudgetSnapshot['normal'];
      tool: OperationBudgetSnapshot['tool'];
    };
  },
): OperationBudgetSnapshot {
  const normal = structuredClone(grant.usage.normal);
  normal.softLimit ??= 0;
  normal.softLimitReached ??= false;
  normal.softLimitWarningPending ??= false;
  const tool = structuredClone(grant.usage.tool);
  tool.softLimit ??= 0;
  tool.softLimitReached ??= false;
  return { normal, tool };
}

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

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  if (
    typeof value === 'number' &&
    (!Number.isFinite(value) || !Number.isInteger(value))
  ) {
    throw new BadRequestException(
      'Canonical execution values must use finite integers',
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function contentHash(value: Buffer | string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function canonicalHash(value: unknown): string {
  return contentHash(canonicalJson(value));
}

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
  ) {}

  resolveAccessScope(
    user: unknown,
    workspaceId?: string,
  ): ExecutionAccessScope {
    const record =
      user && typeof user === 'object' ? (user as Record<string, unknown>) : {};
    const owner = record.userId ?? record.sub ?? 'standalone';
    return {
      ownerPrincipal: String(owner),
      workspaceId: (workspaceId || 'default').trim().slice(0, 200) || 'default',
    };
  }

  async createForChat(
    executionKind: 'assistant_chat' | 'agent_chat',
    message: string,
    scope: ExecutionAccessScope,
    payload: Record<string, unknown>,
  ): Promise<ExecutionEntity> {
    const executionId = randomUUID();
    const rootExecutionId = executionId;
    const turnId = randomUUID();
    const artifactId = randomUUID();
    const sourceId = randomUUID();
    const safeMessage = redactExecutionText(message);
    const body = Buffer.from(safeMessage, 'utf8');

    return this.dataSource.transaction(async (manager) => {
      const execution = manager.getRepository(ExecutionEntity).create({
        executionId,
        rootExecutionId,
        parentExecutionId: null,
        turnId,
        ownerPrincipal: scope.ownerPrincipal,
        workspaceId: scope.workspaceId,
        schemaVersion: EXECUTION_SCHEMA,
        taskType:
          executionKind === 'assistant_chat' ? 'assistant-chat' : 'agent-chat',
        origin: 'root',
        priority: ExecutionPriority.HIGH,
        payload,
        status: ExecutionStatus.QUEUED,
        phase: null,
        waitReason: null,
        completionKind: null,
        completionReason: null,
        result: null,
        error: null,
        checkpoint: null,
        progressPolicy: null,
        progressLedger: null,
        completedAt: null,
        lastSequence: '0',
        lastEventId: null,
        completenessStatus: 'reproducible',
        missingEvidence: [],
      });
      await manager.save(execution);
      await manager.save(
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
          inputSourceIds: [],
          storageRef: `execution:${rootExecutionId}:artifact:${artifactId}`,
          body,
        }),
      );
      await createExecutionStep(manager, {
        executionId,
        stepKind: ExecutionStepKind.INFERENCE,
        inputArtifactRefs: [{ role: 'user_message', artifactId }],
        work: { taskType: execution.taskType, payload },
        requiredCapabilities: [execution.taskType],
        priority: STEP_PRIORITY[ExecutionPriority.HIGH],
      });

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
      return manager.save(execution);
    });
  }

  async create(
    taskType: string,
    priority: ExecutionPriority,
    payload: Record<string, unknown>,
    options?: {
      origin?: string;
      rootExecutionId?: string;
      parentExecutionId?: string;
      ownerPrincipal?: string;
      workspaceId?: string;
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
    },
  ): Promise<ExecutionEntity> {
    const executionId = randomUUID();
    const rootExecutionId = options?.rootExecutionId ?? executionId;
    return this.dataSource.transaction(async (manager) => {
      const execution = manager.getRepository(ExecutionEntity).create({
        executionId,
        rootExecutionId,
        parentExecutionId: options?.parentExecutionId ?? null,
        turnId: null,
        ownerPrincipal: options?.ownerPrincipal ?? 'system',
        workspaceId: options?.workspaceId ?? 'default',
        schemaVersion: EXECUTION_SCHEMA,
        taskType,
        origin: options?.origin ?? 'root',
        priority,
        payload,
        status: ExecutionStatus.QUEUED,
        phase: null,
        waitReason: null,
        completionKind: null,
        completionReason: null,
        result: null,
        error: null,
        checkpoint: null,
        progressPolicy: null,
        progressLedger: null,
        completedAt: null,
        lastSequence: '0',
        lastEventId: null,
        completenessStatus: 'reproducible',
        missingEvidence: [],
      });
      await manager.save(execution);
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
      const steps = options?.steps ?? [
        {
          stepKind: ExecutionStepKind.SERVICE,
          work: { taskType, payload },
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
        });
      }
      const executionEvent = await this.appendBackendEvent(
        manager,
        execution,
        1,
        {
          eventType: 'execution.created',
          payloadSchema: 'execution.created/1',
          payload: { executionKind: taskType, initialStatus: 'queued' },
          actor: { type: 'system' },
          executionId,
          artifactRefs: inputArtifactRefs.map(({ artifactId }) => artifactId),
        },
        1,
      );
      execution.lastSequence = '1';
      execution.lastEventId = executionEvent.eventId;
      return manager.save(execution);
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
          AND "phase" = 'backend_finalization'
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

      execution.phase = 'domain_finalization';
      return executionRepo.save(execution);
    });
  }

  async recoverStaleFinalizations(staleBefore: Date): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager.query(
        `
          UPDATE "executions"
          SET "phase" = 'backend_finalization', "updated_at" = now()
          WHERE "status" = 'running'
            AND "phase" = 'domain_finalization'
            AND "updated_at" <= $1
          RETURNING "execution_id"
        `,
        [staleBefore],
      );
      return rows.length;
    });
  }

  async updateStatus(
    executionId: string,
    status: ExecutionStatus,
    failureMessage?: string,
    options?: { completionReason?: string },
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
      execution.status = status;
      if (
        status === ExecutionStatus.QUEUED ||
        status === ExecutionStatus.WAITING
      ) {
        execution.phase = null;
      }
      if (TERMINAL_STATES.has(status)) {
        execution.completedAt = new Date();
        execution.phase = null;
        execution.completionKind = 'full';
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
      return execution;
    });
  }

  async markAsCompleted(executionId: string): Promise<ExecutionEntity | null> {
    return this.updateStatus(executionId, ExecutionStatus.COMPLETED);
  }

  async markAsFailed(
    executionId: string,
    failureMessage?: string,
  ): Promise<ExecutionEntity | null> {
    return this.updateStatus(
      executionId,
      ExecutionStatus.FAILED,
      failureMessage,
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
        await this.validateOperationBudgetStart(
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
      await this.refreshProgressProjection(eventRepo, execution);
      await executionRepo.save(execution);
      return { accepted, duplicates, lastSequence: sequence };
    });
  }

  async requestProgressGrant(
    rootExecutionId: string,
    request: ProgressGrantRequest,
  ): Promise<{
    grant: OperationBudgetGrant;
    budgetState: OperationBudgetSnapshot;
    guardState: ExactToolRepeatGuardState;
    eventId: string;
  }> {
    validateProgressGrantRequest(rootExecutionId, request);
    return this.dataSource.transaction(async (manager) => {
      const executionRepo = manager.getRepository(ExecutionEntity);
      const eventRepo = manager.getRepository(ExecutionEventEntity);
      const execution = await executionRepo.findOne({
        where: { executionId: rootExecutionId, rootExecutionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!execution) throw new NotFoundException('Execution not found');
      await this.assertCurrentStepAttempt(
        manager,
        execution,
        request.executionAttemptId,
      );
      assertGrantScope(execution, request);

      const rows = await eventRepo.find({
        where: { rootExecutionId },
        order: { sequence: 'ASC' },
      });
      const progress = projectExecutionProgress(
        rows.map((row) => row.envelope as ProgressEvent),
      );
      const existing = Object.values(
        progress.ledger.operationBudget?.grants ?? {},
      )[0];
      if (existing) {
        const comparableRequest = structuredClone(
          request.requestedPolicy,
        ) as Record<string, unknown>;
        if (existing.requestedPolicy.normalInferenceSoftLimit === undefined) {
          delete comparableRequest.normalInferenceSoftLimit;
        }
        if (existing.requestedPolicy.toolCallSoftLimit === undefined) {
          delete comparableRequest.toolCallSoftLimit;
        }
        if (existing.requestedPolicy.exactToolRepeatWarning === undefined) {
          delete comparableRequest.exactToolRepeatWarning;
        }
        if (
          existing.requestedPolicy.exactToolRepeatBlockAfterWarning ===
          undefined
        ) {
          delete comparableRequest.exactToolRepeatBlockAfterWarning;
        }
        if (
          existing.requestedPolicy.exactToolRepeatTerminateAfterBlock ===
          undefined
        ) {
          delete comparableRequest.exactToolRepeatTerminateAfterBlock;
        }
        if (
          existing.loopId !== request.loopId ||
          canonicalJson(existing.requestedPolicy) !==
            canonicalJson(comparableRequest)
        ) {
          throw new ConflictException(
            'An incompatible progress grant already exists',
          );
        }
        const event = rows.find(
          (row) =>
            (row.envelope.payload as Record<string, any>)?.grant?.grantId ===
            existing.grantId,
        );
        return {
          grant: withoutGrantUsage(existing),
          budgetState: operationBudgetSnapshot(existing),
          guardState: exactToolRepeatGuardSnapshot(
            progress.ledger,
            existing.grantId,
          ),
          eventId: event!.eventId,
        };
      }

      const now = new Date().toISOString();
      const effectivePolicy = resolveEffectivePolicy(request.requestedPolicy, {
        normal: Math.max(
          1,
          this.progressLimit('PROGRESS_CHAT_MAX_NORMAL_INFERENCES', 3),
        ),
        normalInferenceSoftLimit: this.progressLimit(
          'PROGRESS_CHAT_NORMAL_INFERENCE_SOFT_LIMIT',
          2,
        ),
        repair: this.progressLimit('PROGRESS_CHAT_MAX_OUTPUT_REPAIRS', 1),
        closing: this.progressLimit('PROGRESS_CHAT_CLOSING_INFERENCES', 1),
        maxTokensPerInference: Math.max(
          1,
          this.progressLimit('PROGRESS_CHAT_MAX_TOKENS_PER_INFERENCE', 4096),
        ),
        toolCalls: this.progressLimit('PROGRESS_CHAT_MAX_TOOL_CALLS', 6),
        toolCallSoftLimit: this.progressLimit(
          'PROGRESS_CHAT_TOOL_CALL_SOFT_LIMIT',
          4,
        ),
        exactToolRepeatWarning:
          this.progressLimit('PROGRESS_CHAT_EXACT_TOOL_REPEAT_WARNING', 1) > 0,
        exactToolRepeatBlockAfterWarning:
          this.progressLimit(
            'PROGRESS_CHAT_EXACT_TOOL_REPEAT_BLOCK_AFTER_WARNING',
            1,
          ) > 0,
        exactToolRepeatTerminateAfterBlock:
          this.progressLimit(
            'PROGRESS_CHAT_EXACT_TOOL_REPEAT_TERMINATE_AFTER_BLOCK',
            1,
          ) > 0,
      });
      const grant = createOperationBudgetGrant(
        execution,
        request,
        effectivePolicy,
        randomUUID(),
        now,
      );
      const producerSequence = this.nextBackendProducerSequence(rows);
      const sequence = Number(execution.lastSequence) + 1;
      const event = await this.appendBackendEvent(
        manager,
        execution,
        producerSequence,
        {
          eventType: 'progress.reported',
          payloadSchema: 'progress.reported/1',
          payload: {
            message: 'Authoritative operation budget granted',
            kind: 'budget_grant',
            grant,
          },
          actor: { type: 'system' },
          executionId: execution.executionId,
          turnId: execution.turnId,
          causedByEventId: execution.lastEventId,
          artifactRefs: [],
        },
        sequence,
      );
      execution.lastSequence = String(sequence);
      execution.lastEventId = event.eventId;
      const refreshed = await this.refreshProgressProjection(
        eventRepo,
        execution,
      );
      await executionRepo.save(execution);
      const projected = refreshed.ledger.operationBudget!.grants[grant.grantId];
      return {
        grant,
        budgetState: operationBudgetSnapshot(projected),
        guardState: exactToolRepeatGuardSnapshot(
          refreshed.ledger,
          grant.grantId,
        ),
        eventId: event.eventId,
      };
    });
  }

  async reserveOperationBudget(
    rootExecutionId: string,
    request: OperationBudgetReservationRequest,
  ): Promise<{
    granted: boolean;
    reservation: OperationBudgetReservation;
    budgetState: OperationBudgetSnapshot;
    softLimitSignal?: BudgetSoftLimitSignal;
    guardState: ExactToolRepeatGuardState;
    loopGuardSignal?: ExactToolRepeatSignal;
    eventId: string;
  }> {
    validateReservationRequest(rootExecutionId, request);
    return this.dataSource.transaction(async (manager) => {
      const executionRepo = manager.getRepository(ExecutionEntity);
      const eventRepo = manager.getRepository(ExecutionEventEntity);
      const execution = await executionRepo.findOne({
        where: { executionId: rootExecutionId, rootExecutionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!execution) throw new NotFoundException('Execution not found');
      await this.assertCurrentStepAttempt(
        manager,
        execution,
        request.executionAttemptId,
      );
      assertReservationScope(execution, request);

      const rows = await eventRepo.find({
        where: { rootExecutionId },
        order: { sequence: 'ASC' },
      });
      const progress = projectExecutionProgress(
        rows.map((row) => row.envelope as ProgressEvent),
      );
      const existing =
        progress.ledger.operationBudget?.reservations[request.operationId];
      if (existing) {
        assertReservationMatches(existing, request);
        const event = rows.find(
          (row) =>
            (row.envelope.payload as Record<string, any>)?.reservation
              ?.operationId === request.operationId,
        );
        const softLimitEvent = rows.find(
          (row) =>
            (row.envelope.payload as Record<string, any>)?.signal
              ?.triggeringOperationId === request.operationId,
        );
        const softLimitPayload = softLimitEvent?.envelope.payload as
          Record<string, unknown> | undefined;
        const softLimitSignal = softLimitPayload?.signal as
          BudgetSoftLimitSignal | undefined;
        const loopGuardEvent = rows.find(
          (row) =>
            (row.envelope.payload as Record<string, any>)?.loopGuardSignal
              ?.triggeringOperationId === request.operationId,
        );
        const loopGuardPayload = loopGuardEvent?.envelope.payload as
          Record<string, unknown> | undefined;
        const loopGuardSignal = loopGuardPayload?.loopGuardSignal as
          ExactToolRepeatSignal | undefined;
        const existingGrant =
          progress.ledger.operationBudget!.grants[existing.grantId];
        const granted = existing.status === 'reserved';
        return {
          granted,
          reservation:
            existing.status === 'consumed'
              ? {
                  ...existing,
                  reason: 'budget_reservation_consumed',
                }
              : existing,
          budgetState: operationBudgetSnapshot(existingGrant),
          ...(softLimitSignal ? { softLimitSignal } : {}),
          guardState: exactToolRepeatGuardSnapshot(
            progress.ledger,
            existing.grantId,
          ),
          ...(loopGuardSignal ? { loopGuardSignal } : {}),
          eventId:
            loopGuardEvent?.eventId ??
            softLimitEvent?.eventId ??
            event!.eventId,
        };
      }
      const grant = progress.ledger.operationBudget?.grants[request.grantId];
      if (!grant || grant.loopId !== request.loopId) {
        throw new BadRequestException('Unknown operation budget grant');
      }
      if (
        request.operationKind === 'tool_call' &&
        grant.effectivePolicy.exactToolRepeatTerminateAfterBlock === true &&
        (request.toolBatchSize === undefined ||
          request.toolBatchIndex === undefined)
      ) {
        throw new BadRequestException(
          'Tool batch identity is required by the active loop guard policy',
        );
      }
      assertBucketMatchesOperation(
        request.operationKind,
        request.bucket,
        request.phase,
      );
      const usage = grant.usage[request.bucket];
      const hasBudget = usage.available > 0;
      const guardBefore = exactToolRepeatGuardSnapshot(
        progress.ledger,
        grant.grantId,
      );
      const terminateSignal =
        hasBudget &&
        grant.effectivePolicy.exactToolRepeatTerminateAfterBlock === true
          ? exactToolRepeatTerminateSignal(rows, request, guardBefore)
          : undefined;
      const blockSignal =
        hasBudget &&
        !terminateSignal &&
        grant.effectivePolicy.exactToolRepeatBlockAfterWarning === true
          ? exactToolRepeatBlockSignal(rows, request, guardBefore)
          : undefined;
      const granted = hasBudget && !terminateSignal && !blockSignal;
      const committed = usage.reserved + usage.consumed + (granted ? 1 : 0);
      const crossesSoftLimit =
        granted &&
        ((request.operationKind === 'tool_call' && request.bucket === 'tool') ||
          (request.operationKind === 'inference' &&
            request.bucket === 'normal')) &&
        Number(usage.softLimit ?? 0) > 0 &&
        !usage.softLimitReached &&
        committed >= Number(usage.softLimit);
      const warningSignal =
        granted && grant.effectivePolicy.exactToolRepeatWarning === true
          ? exactToolRepeatWarningSignal(rows, request, guardBefore)
          : undefined;
      const loopGuardSignal = terminateSignal ?? blockSignal ?? warningSignal;
      const reservation = createOperationBudgetReservation(
        request,
        granted,
        randomUUID(),
        new Date().toISOString(),
        terminateSignal
          ? 'immediate_exact_tool_repeat_terminated'
          : blockSignal
            ? 'immediate_exact_tool_repeat_blocked'
            : undefined,
      );
      let producerSequence = this.nextBackendProducerSequence(rows);
      let sequence = Number(execution.lastSequence) + 1;
      const event = await this.appendBackendEvent(
        manager,
        execution,
        producerSequence,
        {
          eventType: 'progress.reported',
          payloadSchema: 'progress.reported/1',
          payload: {
            message: granted
              ? 'Operation budget reserved'
              : loopGuardSignal
                ? terminateSignal
                  ? 'Execution terminated by loop guard'
                  : 'Operation blocked by loop guard'
                : 'Operation budget reservation denied',
            kind: 'budget_reservation',
            reservation,
          },
          actor: { type: 'system' },
          executionId: execution.executionId,
          turnId: execution.turnId,
          causedByEventId: execution.lastEventId,
          artifactRefs: [],
        },
        sequence,
      );
      let lastEventId = event.eventId;
      let softLimitSignal: BudgetSoftLimitSignal | undefined;
      if (crossesSoftLimit) {
        softLimitSignal = {
          version: '1',
          grantId: grant.grantId,
          operationKind: request.operationKind,
          bucket: request.bucket as 'normal' | 'tool',
          softLimit: Number(usage.softLimit),
          hardLimit: usage.granted,
          committed,
          available: Math.max(0, usage.granted - committed),
          triggeringOperationId: request.operationId,
          executionAttemptId: request.executionAttemptId,
          decidedAt: new Date().toISOString(),
        };
        const signalEvent = await this.appendBackendEvent(
          manager,
          execution,
          ++producerSequence,
          {
            eventType: 'progress.reported',
            payloadSchema: 'progress.reported/1',
            payload: {
              message:
                request.operationKind === 'tool_call'
                  ? 'Tool budget soft limit reached'
                  : 'Normal inference budget soft limit reached',
              kind: 'budget_soft_limit_reached',
              signal: softLimitSignal,
            },
            actor: { type: 'system' },
            executionId: execution.executionId,
            turnId: execution.turnId,
            causedByEventId: event.eventId,
            artifactRefs: [],
          },
          ++sequence,
        );
        lastEventId = signalEvent.eventId;
      }
      if (loopGuardSignal) {
        const signalEvent = await this.appendBackendEvent(
          manager,
          execution,
          ++producerSequence,
          {
            eventType: 'progress.reported',
            payloadSchema: 'progress.reported/1',
            payload: {
              message:
                loopGuardSignal.action === 'terminate'
                  ? 'Immediate exact tool repeat persisted'
                  : loopGuardSignal.action === 'block'
                    ? 'Immediate exact tool repeat blocked'
                    : 'Immediate exact tool repeat detected',
              kind: 'loop_guard_triggered',
              loopGuardSignal,
            },
            actor: { type: 'system' },
            executionId: execution.executionId,
            turnId: execution.turnId,
            causedByEventId: event.eventId,
            artifactRefs: [],
          },
          ++sequence,
        );
        lastEventId = signalEvent.eventId;
      }
      execution.lastSequence = String(sequence);
      execution.lastEventId = lastEventId;
      const refreshed = await this.refreshProgressProjection(
        eventRepo,
        execution,
      );
      await executionRepo.save(execution);
      const projected = refreshed.ledger.operationBudget!.grants[grant.grantId];
      return {
        granted,
        reservation,
        budgetState: operationBudgetSnapshot(projected),
        ...(softLimitSignal ? { softLimitSignal } : {}),
        guardState: exactToolRepeatGuardSnapshot(
          refreshed.ledger,
          grant.grantId,
        ),
        ...(loopGuardSignal ? { loopGuardSignal } : {}),
        eventId: lastEventId,
      };
    });
  }

  async completeExecution(
    executionId: string,
    reply: string,
    error: string | null,
    telemetry?: ExecutionTelemetrySummary,
    completion?: ExecutionCompletion,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const executionRepo = manager.getRepository(ExecutionEntity);
      const eventRepo = manager.getRepository(ExecutionEventEntity);
      const execution = await executionRepo.findOne({
        where: { executionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!execution) return;
      for (const item of telemetry?.errors ?? []) {
        this.addMissing(
          execution,
          `models_telemetry:${String(item).slice(0, 160)}`,
        );
      }
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
      if (
        completion?.partialResult?.executionAttemptId &&
        !TERMINAL_STATES.has(execution.status)
      ) {
        await this.assertCurrentStepAttempt(
          manager,
          execution,
          completion.partialResult.executionAttemptId,
        );
      }
      this.assertLoopDetectedCompletion(execution, rows, error, completion);
      this.assertDeterministicPartial(
        execution,
        rows,
        artifacts,
        reply,
        error,
        completion,
      );
      let lastEventId = rows.at(-1)?.eventId ?? execution.lastEventId;
      let sequence = Number(execution.lastSequence);
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
          row.eventType === 'message.recorded' &&
          payload?.messageKind === 'final_response'
        );
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
            inputSourceIds: [],
            storageRef: `execution:${execution.rootExecutionId}:artifact:${artifactId}`,
            body,
          }),
        );
        sequence += 1;
        const messageEvent = await this.appendBackendEvent(
          manager,
          execution,
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
        const progress = await this.refreshProgressProjection(
          eventRepo,
          execution,
        );
        sequence += 1;
        const progressEvent = await this.appendBackendEvent(
          manager,
          execution,
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
          execution,
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
                      completionReason === 'loop_detected'
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
        execution.status = status as ExecutionStatus;
        execution.completionKind = completionKind;
        execution.completionReason = completionReason;
        execution.result = finalResult;
        execution.error = error
          ? {
              code:
                completionReason === 'loop_detected'
                  ? 'IMMEDIATE_EXACT_TOOL_REPEAT_PERSISTED'
                  : 'CHAT_FAILED',
              message: redactExecutionText(error),
            }
          : null;
      }
      execution.lastSequence = String(sequence);
      if ((telemetry?.errors?.length ?? 0) > 0) {
        execution.completenessStatus = 'evaluable_partial';
      }
      execution.lastEventId = lastEventId;
      execution.completedAt = new Date();
      execution.phase = null;
      await this.refreshProgressProjection(eventRepo, execution);
      await executionRepo.save(execution);
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
    if (completion.partialResult?.executionAttemptId) {
      await this.assertCurrentStepAttempt(
        this.dataSource.manager,
        execution,
        completion.partialResult.executionAttemptId,
      );
    }
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
      !['budget_exhausted', 'tool_budget_exhausted', 'loop_detected'].includes(
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
        startPayload?.['executionAttemptId'] !== partial.executionAttemptId ||
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
      const result = payload?.['result'] as Record<string, any> | undefined;
      if (result?.['pendingConfirmation']) {
        throw new BadRequestException(
          'Runtime template completion has a pending confirmation',
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
          signal?.['loopId'] === partial.loopId &&
          signal?.['executionAttemptId'] === partial.executionAttemptId
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
          payload?.['budgetGrantId'] === partial.grantId &&
          payload?.['executionAttemptId'] === partial.executionAttemptId
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
      !EXECUTION_UUID_PATTERN.test(partial.executionAttemptId) ||
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
    if (completion?.reason !== 'loop_detected') return;
    const hasTermination = rows.some((row) => {
      const payload = row.envelope.payload as Record<string, any> | undefined;
      const signal = payload?.loopGuardSignal as
        Record<string, unknown> | undefined;
      return (
        row.executionId === execution.executionId &&
        row.eventType === 'progress.reported' &&
        payload?.kind === 'loop_guard_triggered' &&
        signal?.action === 'terminate' &&
        EXECUTION_UUID_PATTERN.test(String(signal?.executionAttemptId ?? ''))
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
    return {
      policy: execution.progressPolicy,
      ledger: execution.progressLedger,
    };
  }

  async exportBundle(rootExecutionId: string, scope: ExecutionAccessScope) {
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
    const environment = {
      documentsRevision: this.config.get('DOCUMENTS_REVISION') ?? 'unknown',
      promptPackages: [],
      toolVersions: [],
      modelFingerprint: null,
      runtimeFingerprint: process.version,
      featureFlags: {},
    };
    const missingEvidence = this.deriveBundleMissingEvidence(
      execution,
      events,
      artifacts,
      environment,
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
      purpose: 'evaluation',
      accessScope: scope,
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
  ): string[] {
    const missing = new Set(execution.missingEvidence ?? []);
    if (environment.documentsRevision === 'unknown') {
      missing.add('environment.documentsRevision');
    }

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
      if (environment.modelFingerprint == null) {
        missing.add('environment.modelFingerprint');
      }
      if ((environment.promptPackages as unknown[]).length === 0) {
        missing.add('environment.promptPackages');
      }
    }
    if (hasTool && (environment.toolVersions as unknown[]).length === 0) {
      missing.add('environment.toolVersions');
    }
    for (const artifact of artifacts) {
      if (artifact.body === null) {
        missing.add(`artifact.${artifact.artifactId}.body`);
      }
    }
    return [...missing].sort();
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
        workspaceId: scope.workspaceId,
      },
    });
    if (!execution) throw new NotFoundException('Execution not found');
    return execution;
  }

  private async refreshProgressProjection(
    eventRepo: Repository<ExecutionEventEntity>,
    execution: ExecutionEntity,
  ) {
    const rows = await eventRepo.find({
      where: { rootExecutionId: execution.rootExecutionId },
      order: { sequence: 'ASC' },
    });
    const progress = projectExecutionProgress(
      rows.map((row) => row.envelope as ProgressEvent),
    );
    execution.progressPolicy = progress.policy;
    execution.progressLedger = progress.ledger;
    return progress;
  }

  private async appendBackendEvent(
    manager: EntityManager,
    execution: ExecutionEntity,
    producerSequence: number,
    data: Record<string, any>,
    assignedSequence?: number,
  ): Promise<ExecutionEventEntity> {
    const sequence = assignedSequence ?? Number(execution.lastSequence) + 1;
    const now = new Date().toISOString();
    const eventId = randomUUID();
    const envelope: Record<string, unknown> = {
      schemaVersion: EXECUTION_EVENT_SCHEMA,
      eventId,
      rootExecutionId: execution.rootExecutionId,
      executionId: data.executionId,
      turnId: data.turnId,
      sequence,
      producerSequence,
      eventType: data.eventType,
      producer: {
        component: 'documents-backend',
        instanceId: process.env.HOSTNAME ?? 'backend',
        version: process.env.npm_package_version ?? 'development',
      },
      actor: data.actor,
      sourceId: data.sourceId,
      attemptId: data.attemptId,
      occurredAt: now,
      ingestedAt: now,
      causedByEventId: data.causedByEventId,
      payloadSchema: data.payloadSchema,
      payload: data.payload,
      artifactRefs: data.artifactRefs ?? [],
      security: {
        dataClassification: 'workspace',
        purpose: 'evaluation',
        allowedDestinations: ['documents', 'ai-train'],
        redactionApplied: data.redactionApplied ?? false,
      },
    };
    const cleanEnvelope = JSON.parse(JSON.stringify(envelope));
    cleanEnvelope.contentHash = canonicalHash(cleanEnvelope);
    const row = manager.getRepository(ExecutionEventEntity).create({
      eventId,
      rootExecutionId: execution.rootExecutionId,
      sequence: String(sequence),
      producerComponent: 'documents-backend',
      producerInstanceId: String((cleanEnvelope.producer as any).instanceId),
      producerSequence: String(producerSequence),
      eventType: data.eventType,
      executionId: data.executionId,
      operationId: data.operationId ?? null,
      attemptId: data.attemptId ?? null,
      causedByEventId: data.causedByEventId ?? null,
      occurredAt: new Date(now),
      ingestedAt: new Date(now),
      contentHash: cleanEnvelope.contentHash,
      envelope: cleanEnvelope,
    });
    return manager.save(row);
  }

  private progressLimit(name: string, fallback: number): number {
    const value = Number(this.config.get<string>(name) ?? fallback);
    return Number.isInteger(value) && value >= 0 ? value : fallback;
  }

  private nextBackendProducerSequence(rows: ExecutionEventEntity[]): number {
    return (
      Math.max(
        1,
        ...rows
          .filter((row) => row.producerComponent === 'documents-backend')
          .map((row) => Number(row.producerSequence)),
      ) + 1
    );
  }

  private async validateOperationBudgetStart(
    eventRepo: Repository<ExecutionEventEntity>,
    execution: ExecutionEntity,
    event: Record<string, unknown>,
  ): Promise<void> {
    const identity = governedBudgetStart(execution, event);
    if (!identity) return;
    const rows = await eventRepo.find({
      where: { rootExecutionId: execution.rootExecutionId },
      order: { sequence: 'ASC' },
    });
    const progress = projectExecutionProgress(
      rows.map((row) => row.envelope as ProgressEvent),
    );
    assertOperationBudgetProjection(
      identity,
      progress.ledger.operationBudget,
      exactToolRepeatGuardSnapshot(progress.ledger, identity.grantId),
    );
  }

  private async assertCurrentStepAttempt(
    manager: EntityManager,
    execution: ExecutionEntity,
    attemptId: string,
  ): Promise<void> {
    if (execution.status !== ExecutionStatus.RUNNING) {
      throw new ConflictException('Execution attempt is not active');
    }
    const attempt = await manager
      .getRepository(ExecutionStepAttemptEntity)
      .findOneBy({ attemptId, executionId: execution.executionId });
    if (
      !attempt ||
      attempt.leaseExpiresAt <= new Date() ||
      ![
        ExecutionStepAttemptStatus.LEASED,
        ExecutionStepAttemptStatus.RUNNING,
      ].includes(attempt.status)
    ) {
      throw new ConflictException('Execution attempt is not active');
    }
    const step = await manager
      .getRepository(ExecutionStepEntity)
      .findOneBy({ stepId: attempt.stepId });
    if (step?.currentAttemptId !== attempt.attemptId) {
      throw new ConflictException('Execution attempt is not active');
    }
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

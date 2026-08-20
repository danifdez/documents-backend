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
} from './execution.types';
import {
  EXECUTION_EVENT_PAYLOADS,
  EXECUTION_BUNDLE_SCHEMA,
  EXECUTION_CONTRACT_SET_HASH,
  EXECUTION_EVENT_SCHEMA,
} from './execution.constants';
import { ExecutionContractValidator } from './execution-contract-validator';
import { ExecutionPriority } from './execution-priority.enum';
import { ExecutionStatus } from './execution-status.enum';
import { WorkerEntity } from '../worker/worker.entity';

const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled']);
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIVATE_REASONING_PATTERN = /<think>[\s\S]*?<\/think>/gi;
const BEARER_PATTERN = /\bbearer\s+[a-z0-9._~+/-]+=*/gi;
const SECRET_VALUE_PATTERN =
  /\b(access[_-]?token|api[_-]?key|auth[_-]?token|authorization|cookie|id[_-]?token|password|refresh[_-]?token|session[_-]?token|token)\s*[:=]\s*([^\s,;]+)/gi;
const PRIVATE_REASONING_DETECTOR = /<think>[\s\S]*?<\/think>/i;
const BEARER_DETECTOR = /\bbearer\s+[a-z0-9._~+/-]+=*/i;
const SECRET_VALUE_DETECTOR =
  /\b(access[_-]?token|api[_-]?key|auth[_-]?token|authorization|cookie|id[_-]?token|password|refresh[_-]?token|session[_-]?token|token)\s*[:=]\s*([^\s,;]+)/i;
const MAX_ARTIFACT_BYTES = 1024 * 1024;
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
        .sort(([left], [right]) => left.localeCompare(right))
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
      throw new BadRequestException(
        `${path}.${key} is forbidden in execution data`,
      );
    }
    rejectForbiddenData(child, `${path}.${key}`);
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
        schemaVersion: EXECUTION_EVENT_SCHEMA,
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
        step: 0,
        maxSteps: 1,
        availableAt: new Date(),
        claimedBy: null,
        attemptId: null,
        retryCount: 0,
        maxAttempts: 3,
        startedAt: null,
        completedAt: null,
        inputBlob: null,
        resultBlob: null,
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
      maxSteps?: number;
      origin?: string;
      rootExecutionId?: string;
      parentExecutionId?: string;
      ownerPrincipal?: string;
      workspaceId?: string;
    },
    inputBlob?: Buffer | null,
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
        schemaVersion: EXECUTION_EVENT_SCHEMA,
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
        step: 0,
        maxSteps: options?.maxSteps ?? 1,
        availableAt: new Date(),
        claimedBy: null,
        attemptId: null,
        retryCount: 0,
        maxAttempts: 3,
        startedAt: null,
        completedAt: null,
        inputBlob: inputBlob ?? null,
        resultBlob: null,
        lastSequence: '0',
        lastEventId: null,
        completenessStatus: 'reproducible',
        missingEvidence: [],
      });
      await manager.save(execution);
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
          artifactRefs: [],
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

  async findReadyForFinalization(): Promise<ExecutionEntity[]> {
    return this.executionRepo.find({
      where: { status: ExecutionStatus.RUNNING, phase: 'backend_finalization' },
      order: { updatedAt: 'ASC' },
    });
  }

  async updateStatus(
    executionId: string,
    status: ExecutionStatus,
    failureMessage?: string,
    options?: {
      completionReason?: string;
      expectedAttemptId?: string | null;
      incrementRetry?: boolean;
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
      if (
        options?.expectedAttemptId !== undefined &&
        execution.attemptId !== options.expectedAttemptId
      ) {
        return null;
      }
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
      const activeAttemptId = execution.attemptId;
      execution.status = status;
      if (options?.incrementRetry) execution.retryCount += 1;
      if (
        status === ExecutionStatus.QUEUED ||
        status === ExecutionStatus.WAITING ||
        TERMINAL_STATES.has(status)
      ) {
        execution.claimedBy = null;
        execution.attemptId = null;
        execution.startedAt = null;
      }
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
          attemptId: activeAttemptId,
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

  async requeueStaleExecutions(heartbeatThresholdDate: Date): Promise<number> {
    const stale = await this.executionRepo
      .createQueryBuilder('execution')
      .innerJoin(WorkerEntity, 'worker', 'worker.id = execution.claimed_by')
      .where('execution.status = :status', { status: ExecutionStatus.RUNNING })
      .andWhere('execution.phase = :phase', { phase: 'worker_execution' })
      .andWhere('worker.last_heartbeat < :threshold', {
        threshold: heartbeatThresholdDate,
      })
      .getMany();
    let recovered = 0;
    for (const execution of stale) {
      const exhausted = execution.retryCount + 1 >= execution.maxAttempts;
      const updated = await this.updateStatus(
        execution.executionId,
        exhausted ? ExecutionStatus.FAILED : ExecutionStatus.QUEUED,
        exhausted ? 'Execution attempts exhausted' : undefined,
        {
          completionReason: exhausted ? 'attempts_exhausted' : undefined,
          expectedAttemptId: execution.attemptId,
          incrementRetry: true,
        },
      );
      if (updated) recovered += 1;
    }
    return recovered;
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
      await executionRepo.save(execution);
      return { accepted, duplicates, lastSequence: sequence };
    });
  }

  async completeExecution(
    executionId: string,
    reply: string,
    error: string | null,
    telemetry?: ExecutionTelemetrySummary,
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
      let lastEventId = rows.at(-1)?.eventId ?? execution.lastEventId;
      let sequence = Number(execution.lastSequence);
      const producerSequence = Math.max(
        2,
        ...rows
          .filter((row) => row.producerComponent === 'documents-backend')
          .map((row) => Number(row.producerSequence)),
      );
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
          producerSequence + 1,
          {
            eventType: 'message.recorded',
            payloadSchema: 'message.recorded/1',
            payload: {
              messageKind: 'final_response',
              role: 'assistant',
              contentPreview: safeReply.slice(0, 512),
              contentArtifactId: artifactId,
              format: 'text',
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
        sequence += 1;
        const status = error ? 'failed' : 'completed';
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
          producerSequence + 2,
          {
            eventType: 'execution.state_changed',
            payloadSchema: 'execution.state_changed/1',
            payload: {
              from: execution.status,
              to: status,
              completionKind: 'full',
              completionReason: error
                ? 'model_or_tool_failed'
                : 'goal_satisfied',
              result: finalResult,
              error: error
                ? { code: 'CHAT_FAILED', message: redactExecutionText(error) }
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
        execution.completionKind = 'full';
        execution.completionReason = error
          ? 'model_or_tool_failed'
          : 'goal_satisfied';
        execution.result = finalResult;
        execution.error = error
          ? { code: 'CHAT_FAILED', message: redactExecutionText(error) }
          : null;
      }
      execution.lastSequence = String(sequence);
      if ((telemetry?.errors?.length ?? 0) > 0) {
        execution.completenessStatus = 'evaluable_partial';
      }
      execution.lastEventId = lastEventId;
      execution.completedAt = new Date();
      execution.phase = null;
      await executionRepo.save(execution);
    });
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

  private validateIncomingEvent(
    execution: ExecutionEntity,
    event: Record<string, unknown>,
  ): void {
    rejectForbiddenData(event);
    for (const field of ['eventId', 'rootExecutionId', 'executionId']) {
      if (!UUID_PATTERN.test(String(event[field] ?? ''))) {
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
    if (!artifact || !UUID_PATTERN.test(String(artifact.artifactId ?? ''))) {
      throw new BadRequestException('artifactId must be a UUID');
    }
    if (
      !HASH_PATTERN.test(String(artifact.contentHash ?? '')) ||
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
    if (
      PRIVATE_REASONING_DETECTOR.test(text) ||
      BEARER_DETECTOR.test(text) ||
      SECRET_VALUE_DETECTOR.test(text)
    ) {
      throw new BadRequestException(
        `Artifact contains unredacted sensitive text: ${artifact.artifactId}`,
      );
    }
    if (/^application\/(json|[^;]+\+json)/.test(artifact.mediaType)) {
      try {
        rejectForbiddenData(JSON.parse(text), '$artifact');
      } catch (error) {
        if (error instanceof BadRequestException) throw error;
      }
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

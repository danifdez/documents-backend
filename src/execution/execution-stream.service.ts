import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { ExecutionArtifactStorageService } from './execution-artifact-storage.service';
import { ExecutionEventEntity } from './execution-event.entity';
import { appendBackendExecutionEvent } from './execution-event.writer';
import { inferenceCaptureAuthorization } from './inference-capture';
import { ExecutionService } from './execution.service';
import { ExecutionEntity } from './execution.entity';
import { ExecutionPriority } from './execution-priority.enum';
import { ExecutionStatus } from './execution-status.enum';
import { ExecutionAccessScope } from './execution.types';
import {
  ExecutionTaskPayload,
  ExecutionTaskType,
} from './execution-task-payload.types';
import { contentHash } from './execution-canonical';
import { canonicalDomainHash } from './execution-canonical';
import { redactExecutionText } from './execution-data-policy';

const terminal = new Set([
  ExecutionStatus.COMPLETED,
  ExecutionStatus.FAILED,
  ExecutionStatus.CANCELLED,
]);

/** Records streaming lifecycles; transport and inference stay in their product. */
@Injectable()
export class ExecutionStreamService {
  constructor(
    private readonly source: DataSource,
    private readonly executions: ExecutionService,
    private readonly storage: ExecutionArtifactStorageService,
  ) {}

  async open<T extends ExecutionTaskType>(
    taskType: T,
    payload: ExecutionTaskPayload<T>,
    requestId: string,
    scope: ExecutionAccessScope,
    missingEvidence: readonly string[] = [],
  ) {
    const execution = await this.executions.create(
      taskType,
      ExecutionPriority.NORMAL,
      payload,
      {
        requestId,
        ownerPrincipal: scope.ownerPrincipal,
        initialStep: null,
      },
    );
    return this.source.transaction(async (manager) => {
      const repo = manager.getRepository(ExecutionEntity);
      const current = await repo.findOneOrFail({
        where: {
          executionId: execution.executionId,
          ownerPrincipal: scope.ownerPrincipal,
        },
        lock: { mode: 'pessimistic_write' },
      });
      const claimed =
        current.status === ExecutionStatus.QUEUED && current.phase === null;
      if (claimed) {
        current.completenessStatus = missingEvidence.length
          ? 'evaluable_partial'
          : current.completenessStatus;
        current.missingEvidence = [...missingEvidence];
        await repo.save(current);
      }
      const accepted = claimed
        ? await this.executions.updateStatus(
            current.executionId,
            ExecutionStatus.RUNNING,
            undefined,
            { phase: 'stream_accepted' },
            manager,
          )
        : current;
      return {
        executionId: accepted.executionId,
        status: accepted.status,
        result:
          accepted.status === ExecutionStatus.COMPLETED
            ? accepted.result
            : null,
        error:
          accepted.status === ExecutionStatus.FAILED ? accepted.error : null,
        claimed,
      };
    });
  }

  /** Persist each input boundary before forwarding; this is not a worker ACK. */
  async captureInput(
    executionId: string,
    taskType: ExecutionTaskType,
    scope: ExecutionAccessScope,
    sequence: number,
    body: Buffer,
  ): Promise<boolean> {
    if (
      !Number.isSafeInteger(sequence) ||
      sequence < 1 ||
      !Buffer.isBuffer(body) ||
      body.length === 0 ||
      body.length > 256 * 1024
    )
      throw new BadRequestException('Invalid stream input');
    return this.source.transaction(async (manager) => {
      const repo = manager.getRepository(ExecutionEntity);
      const current = await repo.findOne({
        where: {
          executionId,
          rootExecutionId: executionId,
          ownerPrincipal: scope.ownerPrincipal,
          taskType,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!current) throw new NotFoundException('Stream execution not found');
      const grant = (
        current.payload as {
          inputCapture?: {
            schemaVersion: string;
            purpose: string;
            authorizedBy: string;
            mediaType: string;
          };
        }
      ).inputCapture;
      const expected = inferenceCaptureAuthorization(scope.ownerPrincipal);
      if (
        !grant ||
        grant.schemaVersion !== expected.schemaVersion ||
        grant.purpose !== expected.purpose ||
        grant.authorizedBy !== expected.authorizedBy ||
        typeof grant.mediaType !== 'string' ||
        grant.mediaType.length > 200 ||
        !/^[a-z0-9.+-]+\/[a-z0-9.+-]+(?:;[a-z0-9=.+-]+)*$/i.test(
          grant.mediaType,
        )
      )
        throw new ForbiddenException('Stream capture is not authorized');
      if (
        current.status !== ExecutionStatus.RUNNING ||
        current.cancellationRequestedAt
      )
        return false;
      const sources = () =>
        manager
          .getRepository(ExecutionEventEntity)
          .createQueryBuilder('event')
          .where('event.root_execution_id = :executionId', { executionId })
          .andWhere("event.event_type = 'source.observed'")
          .andWhere(
            "event.envelope->'payload'->'metadata'->>'streamInputSequence' IS NOT NULL",
          );
      const last = await sources().orderBy('event.sequence', 'DESC').getOne();
      const metadata = (last?.envelope.payload as Record<string, any>)
        ?.metadata;
      const lastSequence = Number(metadata?.streamInputSequence ?? 0);
      const hash = contentHash(body);
      if (sequence <= lastSequence) {
        const existing = await sources()
          .andWhere(
            "event.envelope->'payload'->'metadata'->>'streamInputSequence' = :sequence",
            { sequence: String(sequence) },
          )
          .getOne();
        if (
          (existing?.envelope.payload as Record<string, unknown>)
            ?.contentHash !== hash
        )
          throw new ConflictException('Stream input identity conflict');
        return false;
      }
      const totalBytes = Number(metadata?.streamInputBytes ?? 0) + body.length;
      if (
        sequence !== lastSequence + 1 ||
        sequence > 4096 ||
        totalBytes > 32 * 1024 * 1024
      )
        throw new BadRequestException('Stream capture limit or order exceeded');
      const artifactId = randomUUID();
      const lastProducer = await manager
        .getRepository(ExecutionEventEntity)
        .findOne({
          where: {
            rootExecutionId: executionId,
            producerComponent: 'documents-backend',
          },
          order: { producerSequence: 'DESC' },
        });
      const event = await appendBackendExecutionEvent(
        manager,
        current,
        Number(lastProducer?.producerSequence ?? 0) + 1,
        {
          eventType: 'source.observed',
          payloadSchema: 'source.observed/1',
          executionId,
          sourceId: artifactId,
          artifactId,
          artifactRefs: [artifactId],
          causedByEventId: current.lastEventId,
          actor: { type: 'user' },
          payload: {
            sourceId: artifactId,
            kind: 'user_input',
            originComponent: 'documents-backend',
            observedAt: new Date().toISOString(),
            contentHash: hash,
            snapshotArtifactId: artifactId,
            trustLevel: 'untrusted_data',
            dataClassification: 'sensitive',
            metadata: {
              streamInputSequence: sequence,
              streamInputBytes: totalBytes,
              mediaType: grant.mediaType,
              mediaTypeVerification: 'client_declared',
              delivery: 'received_before_forwarding',
            },
          },
        },
      );
      await this.storage.save(manager, {
        artifactId,
        rootExecutionId: executionId,
        kind: 'stream_input',
        contentHash: hash,
        size: String(body.length),
        mediaType: grant.mediaType,
        encoding: 'identity',
        dataClassification: 'sensitive',
        redaction: { applied: false, authorizedCapture: true },
        retentionClass: 'evaluation',
        createdByEventId: event.eventId,
        inputSourceIds: [artifactId],
        body,
      });
      current.lastSequence = event.sequence;
      current.lastEventId = event.eventId;
      current.missingEvidence = current.missingEvidence.filter(
        (value) => value !== 'stream.input_not_captured',
      );
      await repo.save(current);
      return true;
    });
  }

  async read(
    requestId: string,
    taskType: ExecutionTaskType,
    scope: ExecutionAccessScope,
  ) {
    const receipt = await this.executions.readRequest(requestId, scope);
    if (!receipt.executionId)
      throw new NotFoundException('Stream execution not found');
    const execution = await this.executions.findOne(receipt.executionId);
    if (execution?.taskType !== taskType)
      throw new NotFoundException('Stream execution not found');
    return receipt;
  }

  async record(
    executionId: string,
    taskType: ExecutionTaskType,
    scope: ExecutionAccessScope,
    status: ExecutionStatus,
    phase: string,
    result?: Record<string, unknown>,
  ) {
    return this.source.transaction(async (manager) => {
      const repo = manager.getRepository(ExecutionEntity);
      const current = await repo.findOne({
        where: {
          executionId,
          rootExecutionId: executionId,
          ownerPrincipal: scope.ownerPrincipal,
          taskType,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!current) throw new NotFoundException('Stream execution not found');
      if (terminal.has(current.status)) {
        if (
          current.status === status &&
          result !== undefined &&
          canonicalDomainHash(current.result) !== canonicalDomainHash(result)
        ) {
          throw new ConflictException(
            'Stream result differs from its terminal record',
          );
        }
        return current;
      }
      if (result !== undefined && !current.cancellationRequestedAt) {
        current.result = result;
        await repo.save(current);
      }
      // Cancellation already requested through the common API wins over output.
      const next = current.cancellationRequestedAt
        ? ExecutionStatus.CANCELLED
        : status;
      return this.executions.updateStatus(
        executionId,
        next,
        next === ExecutionStatus.FAILED
          ? redactExecutionText(phase)
          : undefined,
        { phase, completionReason: phase },
        manager,
      );
    });
  }
}

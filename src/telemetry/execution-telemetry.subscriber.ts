import {
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
  TransactionCommitEvent,
  TransactionRollbackEvent,
  TransactionStartEvent,
} from 'typeorm';
import { EXECUTION_UUID_PATTERN } from '../execution/execution.constants';
import { ExecutionEntity } from '../execution/execution.entity';
import { ExecutionEventEntity } from '../execution/execution-event.entity';
import {
  ExecutionEventSnapshot,
  executionEventMetadata,
} from './execution-lifecycle';
import {
  isTelemetryEnabled,
  recordExecutionEvent,
  safeTraceContext,
} from './telemetry';

const framesKey = 'documents.telemetry.events';
type Frames = ExecutionEventSnapshot[][];

type ExecutionEventSubscriber = EntitySubscriberInterface<ExecutionEventEntity>;

@EventSubscriber()
export class ExecutionTelemetrySubscriber implements ExecutionEventSubscriber {
  listenTo() {
    return ExecutionEventEntity;
  }

  afterTransactionStart(event: TransactionStartEvent): void {
    if (!isTelemetryEnabled()) return;
    const frames: Frames = (event.queryRunner.data[framesKey] ??= []);
    frames.push([]);
  }

  async afterInsert(event: InsertEvent<ExecutionEventEntity>): Promise<void> {
    if (!isTelemetryEnabled() || !event.entity) return;
    // Observer failure must never roll back a product transaction.
    try {
      const row = event.entity;
      const execution = await event.manager
        .getRepository(ExecutionEntity)
        .findOne({
          where: { executionId: row.executionId },
          select: {
            executionId: true,
            traceContext: true,
            createdAt: true,
            parentExecutionId: true,
          },
        });
      if (!execution) return;
      let startedAt: Date | undefined;
      if (row.eventType === 'operation.finished' && row.causedByEventId) {
        const start = await event.manager
          .getRepository(ExecutionEventEntity)
          .findOne({
            where: { eventId: row.causedByEventId },
            select: {
              eventType: true,
              attemptId: true,
              operationId: true,
              occurredAt: true,
            },
          });
        if (
          start?.eventType === 'operation.started' &&
          start.attemptId === row.attemptId &&
          start.operationId === row.operationId
        )
          startedAt = start.occurredAt;
      } else if (row.eventType === 'execution.state_changed') {
        startedAt = execution.createdAt;
      }
      const metadata = executionEventMetadata({
        envelope: row.envelope,
        traceContext: null,
        startedAt,
      });
      if (!metadata) return;
      if (
        typeof execution.parentExecutionId === 'string' &&
        EXECUTION_UUID_PATTERN.test(execution.parentExecutionId)
      )
        metadata.attributes['execution.parentExecutionId'] =
          execution.parentExecutionId;
      const snapshot: ExecutionEventSnapshot = {
        metadata,
        traceContext: safeTraceContext(execution.traceContext),
      };
      if (event.queryRunner.isTransactionActive) {
        const frames: Frames = (event.queryRunner.data[framesKey] ??= [[]]);
        if (!frames.length) frames.push([]);
        frames.at(-1).push(snapshot);
      } else {
        this.publish([snapshot]);
      }
    } catch {
      /* telemetry is best effort; the canonical event remains in PostgreSQL */
    }
  }

  afterTransactionCommit(event: TransactionCommitEvent): void {
    const frames: Frames | undefined = event.queryRunner.data[framesKey];
    if (!frames?.length) return;
    const committed = frames.pop()!;
    if (event.queryRunner.isTransactionActive) {
      if (!frames.length) frames.push([]);
      frames.at(-1).push(...committed);
    } else {
      delete event.queryRunner.data[framesKey];
      this.publish([...frames.flat(), ...committed]);
    }
  }

  afterTransactionRollback(event: TransactionRollbackEvent): void {
    const frames: Frames | undefined = event.queryRunner.data[framesKey];
    frames?.pop();
    if (!event.queryRunner.isTransactionActive)
      delete event.queryRunner.data[framesKey];
  }

  private publish(events: ExecutionEventSnapshot[]): void {
    for (const event of events) {
      try {
        recordExecutionEvent(event);
      } catch {
        /* never affect result delivery */
      }
    }
  }
}

import { readString } from '../utils/read-string';
import type { Attributes } from '@opentelemetry/api';
import { EXECUTION_EVENT_PAYLOADS } from '../execution/execution.constants';
import { ExecutionStatus } from '../execution/execution-status.enum';
import { ExecutionOperationStatus } from '../execution/execution-operation-status.enum';
import { ExecutionOperationKind } from '../execution/execution-operation-kind.enum';

export interface CommittedExecutionEvent {
  envelope: Record<string, unknown>;
  traceContext: unknown;
  startedAt?: Date;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const states = new Set<string>([
  ...Object.values(ExecutionStatus),
  ...Object.values(ExecutionOperationStatus),
]);

// This is a stateless projection of the existing event contract, not another
// execution tracker. Never export the event envelope or any free-text field.
export function executionEventMetadata(event: CommittedExecutionEvent): {
  name: string;
  attributes: Attributes;
  occurredAt: Date;
  startedAt: Date;
  failed: boolean;
} | null {
  const data = event.envelope;
  const type = readString(data.eventType);
  if (!Object.hasOwn(EXECUTION_EVENT_PAYLOADS, type)) return null;
  const occurredAt = new Date(readString(data.occurredAt));
  if (!Number.isFinite(occurredAt.getTime())) return null;
  const attributes: Attributes = { 'execution.event.type': type };
  for (const key of [
    'eventId',
    'rootExecutionId',
    'executionId',
    'stepId',
    'operationId',
    'attemptId',
    'causedByEventId',
  ]) {
    const value = data[key];
    if (typeof value === 'string' && uuid.test(value))
      attributes['execution.' + key] = value;
  }
  if (Number.isSafeInteger(data.sequence) && Number(data.sequence) >= 0)
    attributes['execution.sequence'] = Number(data.sequence);
  const payload =
    data.payload && typeof data.payload === 'object'
      ? (data.payload as Record<string, unknown>)
      : {};
  for (const key of ['from', 'to', 'status', 'initialStatus']) {
    const value = payload[key];
    if (typeof value === 'string' && states.has(value))
      attributes['execution.' + key] = value;
  }
  if (
    Object.values(ExecutionOperationKind).includes(
      payload.operationKind as ExecutionOperationKind,
    )
  )
    attributes['execution.operationKind'] = payload.operationKind as string;
  const error =
    payload.error && typeof payload.error === 'object'
      ? (payload.error as Record<string, unknown>)
      : {};
  if (typeof error.retryable === 'boolean')
    attributes['execution.retryable'] = error.retryable;
  const startedAt =
    event.startedAt &&
    Number.isFinite(event.startedAt.getTime()) &&
    event.startedAt <= occurredAt
      ? event.startedAt
      : occurredAt;
  return {
    name:
      type === 'operation.finished'
        ? 'documents.operation'
        : type === 'execution.state_changed' &&
            ['completed', 'failed', 'cancelled'].includes(
              readString(payload.to),
            )
          ? 'documents.execution'
          : 'documents.' + type,
    attributes,
    occurredAt,
    startedAt,
    failed: payload.to === 'failed' || payload.status === 'failed',
  };
}

export interface ExecutionEventSnapshot {
  metadata: NonNullable<ReturnType<typeof executionEventMetadata>>;
  traceContext: unknown;
}

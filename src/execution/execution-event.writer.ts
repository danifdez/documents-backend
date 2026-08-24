import { randomUUID } from 'crypto';
import { EntityManager } from 'typeorm';
import { canonicalHash } from './execution-canonical';
import { EXECUTION_EVENT_SCHEMA } from './execution.constants';
import { ExecutionEntity } from './execution.entity';
import { ExecutionEventEntity } from './execution-event.entity';

export interface BackendExecutionEventData {
  eventType: string;
  payloadSchema: string;
  payload: Record<string, unknown>;
  actor: Record<string, unknown>;
  executionId: string;
  turnId?: string | null;
  stepId?: string | null;
  operationId?: string | null;
  toolCallId?: string | null;
  attemptId?: string | null;
  sourceId?: string | null;
  causedByEventId?: string | null;
  artifactRefs?: string[];
  redactionApplied?: boolean;
}

export async function appendBackendExecutionEvent(
  manager: EntityManager,
  execution: ExecutionEntity,
  producerSequence: number,
  data: BackendExecutionEventData,
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
    stepId: data.stepId,
    operationId: data.operationId,
    toolCallId: data.toolCallId,
    attemptId: data.attemptId,
    sourceId: data.sourceId,
    sequence,
    producerSequence,
    eventType: data.eventType,
    producer: {
      component: 'documents-backend',
      instanceId: process.env.HOSTNAME ?? 'backend',
      version: process.env.npm_package_version ?? 'development',
    },
    actor: data.actor,
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
    producerInstanceId: String(
      (cleanEnvelope.producer as Record<string, unknown>).instanceId,
    ),
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

export function nextBackendProducerSequence(
  rows: ExecutionEventEntity[],
): number {
  return (
    Math.max(
      1,
      ...rows
        .filter((row) => row.producerComponent === 'documents-backend')
        .map((row) => Number(row.producerSequence)),
    ) + 1
  );
}

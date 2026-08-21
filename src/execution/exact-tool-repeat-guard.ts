import type { ExecutionEventEntity } from './execution-event.entity';
import { EXECUTION_CONTENT_HASH_PATTERN } from './execution.constants';
import type { OperationBudgetReservationRequest } from './execution.types';
import type {
  ExactToolRepeatGuardState,
  ExactToolRepeatSignal,
} from './execution-progress';

type EventView = {
  eventType: string;
  operationId?: string | null;
  attemptId?: string | null;
  payload?: Record<string, any>;
};

type GuardAppliedFlag =
  'loopGuardWarningApplied' | 'loopGuardBlockResultApplied';

// Distingue "no filtres por intento" de "filtra por un attemptId ausente":
// la etapa de aviso exige que el intento coincida, la de bloqueo no.
const ANY_ATTEMPT = Symbol('any-attempt');

const view = (row: ExecutionEventEntity): EventView =>
  row.envelope as unknown as EventView;

const guardSignalOf = (
  row: ExecutionEventEntity | undefined,
): ExactToolRepeatSignal | undefined =>
  (row?.envelope.payload as Record<string, any> | undefined)?.loopGuardSignal;

function isFingerprintedToolRepeatCandidate(
  request: OperationBudgetReservationRequest,
): boolean {
  return (
    request.operationKind === 'tool_call' &&
    !!request.operationFingerprint &&
    request.operationFingerprintVersion === 'canonical_tool_input_v1'
  );
}

function lastToolStart(
  rows: ExecutionEventEntity[],
  request: OperationBudgetReservationRequest,
): ExecutionEventEntity | undefined {
  return [...rows].reverse().find((row) => {
    const { eventType, payload } = view(row);
    return (
      eventType === 'operation.started' &&
      payload?.operationKind === 'tool_call' &&
      payload.loopId === request.loopId &&
      payload.budgetGrantId === request.grantId
    );
  });
}

function succeededToolFinish(
  rows: ExecutionEventEntity[],
  operationId: unknown,
  attemptId: unknown = ANY_ATTEMPT,
): ExecutionEventEntity | undefined {
  return rows.find((row) => {
    const event = view(row);
    return (
      event.eventType === 'operation.finished' &&
      event.operationId === operationId &&
      (attemptId === ANY_ATTEMPT || event.attemptId === attemptId) &&
      event.payload?.operationKind === 'tool_call' &&
      event.payload.status === 'succeeded' &&
      event.payload.result?.pendingConfirmation !== true
    );
  });
}

function repeatsSameTool(
  payload: Record<string, any> | undefined,
  request: OperationBudgetReservationRequest,
): boolean {
  return (
    payload?.name === request.name &&
    payload.operationFingerprint === request.operationFingerprint &&
    payload.operationFingerprintVersion ===
      request.operationFingerprintVersion &&
    payload.executionAttemptId === request.executionAttemptId
  );
}

function guardApplication(
  rows: ExecutionEventEntity[],
  request: OperationBudgetReservationRequest,
  operationId: string,
  appliedFlag: GuardAppliedFlag,
): ExecutionEventEntity | undefined {
  return rows.find((row) => {
    const event = view(row);
    return (
      event.eventType === 'operation.started' &&
      event.operationId === operationId &&
      event.payload?.operationKind === 'inference' &&
      event.payload.budgetBucket === 'normal' &&
      event.payload.budgetGrantId === request.grantId &&
      event.payload.loopId === request.loopId &&
      event.payload[appliedFlag] === true &&
      event.payload.executionAttemptId === request.executionAttemptId
    );
  });
}

function toolOutputSource(
  rows: ExecutionEventEntity[],
  operationId: string,
): ExecutionEventEntity | undefined {
  return rows.find((row) => {
    const event = view(row);
    return (
      event.eventType === 'source.observed' &&
      event.operationId === operationId &&
      event.payload?.kind === 'tool_output' &&
      EXECUTION_CONTENT_HASH_PATTERN.test(
        String(event.payload.contentHash ?? ''),
      )
    );
  });
}

export function exactToolRepeatWarningSignal(
  rows: ExecutionEventEntity[],
  request: OperationBudgetReservationRequest,
  guard: ExactToolRepeatGuardState,
): ExactToolRepeatSignal | undefined {
  if (!isFingerprintedToolRepeatCandidate(request) || guard.warningIssued) {
    return undefined;
  }
  const previous = lastToolStart(rows, request);
  if (!previous) return undefined;
  const { operationId, attemptId, payload } = view(previous);
  if (!repeatsSameTool(payload, request)) return undefined;
  if (!succeededToolFinish(rows, operationId, attemptId)) return undefined;
  return {
    version: '1',
    guardKind: 'immediate_exact_tool_repeat',
    action: 'warn',
    grantId: request.grantId,
    loopId: request.loopId,
    previousOperationId: String(operationId),
    triggeringOperationId: request.operationId,
    operationFingerprint: request.operationFingerprint,
    operationFingerprintVersion: 'canonical_tool_input_v1',
    executionAttemptId: request.executionAttemptId,
    decidedAt: new Date().toISOString(),
  };
}

export function exactToolRepeatBlockSignal(
  rows: ExecutionEventEntity[],
  request: OperationBudgetReservationRequest,
  guard: ExactToolRepeatGuardState,
): Extract<ExactToolRepeatSignal, { action: 'block' }> | undefined {
  if (
    !isFingerprintedToolRepeatCandidate(request) ||
    !guard.warningAppliedToOperationId
  ) {
    return undefined;
  }
  const warningSignal = rows
    .map((row) => guardSignalOf(row))
    .find(
      (signal) =>
        signal?.action === 'warn' &&
        signal.grantId === request.grantId &&
        signal.loopId === request.loopId,
    );
  if (
    !warningSignal ||
    warningSignal.operationFingerprint !== request.operationFingerprint ||
    warningSignal.operationFingerprintVersion !==
      request.operationFingerprintVersion ||
    warningSignal.executionAttemptId !== request.executionAttemptId
  ) {
    return undefined;
  }
  const warningApplication = guardApplication(
    rows,
    request,
    guard.warningAppliedToOperationId,
    'loopGuardWarningApplied',
  );
  if (!warningApplication) return undefined;
  const lastTool = lastToolStart(rows, request);
  if (!lastTool) return undefined;
  const last = view(lastTool);
  if (
    last.operationId !== warningSignal.triggeringOperationId ||
    !repeatsSameTool(last.payload, request)
  ) {
    return undefined;
  }
  const successfulOperations = new Set([
    warningSignal.previousOperationId,
    warningSignal.triggeringOperationId,
  ]);
  const successfulFinishes: ExecutionEventEntity[] = [];
  for (const operationId of successfulOperations) {
    const finished = succeededToolFinish(rows, operationId);
    if (!finished) return undefined;
    successfulFinishes.push(finished);
  }
  const resultSources = [...successfulOperations].map((operationId) =>
    toolOutputSource(rows, operationId),
  );
  const warningApplicationSequence = Number(warningApplication.sequence);
  if (
    successfulFinishes.some(
      (event) => Number(event.sequence) >= warningApplicationSequence,
    ) ||
    resultSources.some(
      (event) => !event || Number(event.sequence) >= warningApplicationSequence,
    )
  ) {
    return undefined;
  }
  const resultHashes = resultSources.map((source) =>
    source ? String(view(source).payload.contentHash) : undefined,
  );
  if (!resultHashes[0] || resultHashes[0] !== resultHashes[1]) {
    return undefined;
  }
  return {
    version: '1',
    guardKind: 'immediate_exact_tool_repeat',
    action: 'block',
    grantId: request.grantId,
    loopId: request.loopId,
    previousOperationId: String(last.operationId),
    triggeringOperationId: request.operationId,
    warningAppliedToOperationId: guard.warningAppliedToOperationId,
    operationFingerprint: request.operationFingerprint,
    operationFingerprintVersion: 'canonical_tool_input_v1',
    resultFingerprint: resultHashes[0],
    resultFingerprintVersion: 'tool_output_content_hash_v1',
    executionAttemptId: request.executionAttemptId,
    decidedAt: new Date().toISOString(),
  };
}

export function exactToolRepeatTerminateSignal(
  rows: ExecutionEventEntity[],
  request: OperationBudgetReservationRequest,
  guard: ExactToolRepeatGuardState,
): Extract<ExactToolRepeatSignal, { action: 'terminate' }> | undefined {
  if (
    !isFingerprintedToolRepeatCandidate(request) ||
    request.toolBatchSize !== 1 ||
    request.toolBatchIndex !== 0 ||
    guard.blockResultPending ||
    !guard.lastBlockedOperationId ||
    !guard.warningAppliedToOperationId ||
    !guard.blockResultAppliedToOperationId
  ) {
    return undefined;
  }
  const blockEvent = rows.find((row) => {
    const signal = guardSignalOf(row);
    return (
      signal?.action === 'block' &&
      signal.grantId === request.grantId &&
      signal.loopId === request.loopId &&
      signal.triggeringOperationId === guard.lastBlockedOperationId
    );
  });
  const blockSignal = guardSignalOf(blockEvent) as
    Extract<ExactToolRepeatSignal, { action: 'block' }> | undefined;
  const application = guardApplication(
    rows,
    request,
    guard.blockResultAppliedToOperationId,
    'loopGuardBlockResultApplied',
  );
  if (
    !blockEvent ||
    !blockSignal ||
    !application ||
    Number(application.sequence) <= Number(blockEvent.sequence) ||
    blockSignal.operationFingerprint !== request.operationFingerprint ||
    blockSignal.operationFingerprintVersion !==
      request.operationFingerprintVersion ||
    blockSignal.executionAttemptId !== request.executionAttemptId
  ) {
    return undefined;
  }
  const lastTool = lastToolStart(rows, request);
  const last = lastTool ? view(lastTool) : undefined;
  if (
    !lastTool ||
    last.operationId !== blockSignal.previousOperationId ||
    !repeatsSameTool(last.payload, request)
  ) {
    return undefined;
  }
  return {
    version: '1',
    guardKind: 'immediate_exact_tool_repeat',
    action: 'terminate',
    grantId: request.grantId,
    loopId: request.loopId,
    previousOperationId: blockSignal.previousOperationId,
    blockedOperationId: blockSignal.triggeringOperationId,
    triggeringOperationId: request.operationId,
    warningAppliedToOperationId: blockSignal.warningAppliedToOperationId,
    blockResultAppliedToOperationId: guard.blockResultAppliedToOperationId,
    operationFingerprint: request.operationFingerprint,
    operationFingerprintVersion: 'canonical_tool_input_v1',
    resultFingerprint: blockSignal.resultFingerprint,
    resultFingerprintVersion: 'tool_output_content_hash_v1',
    executionAttemptId: request.executionAttemptId,
    decidedAt: new Date().toISOString(),
  };
}

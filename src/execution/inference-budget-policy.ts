import { BadRequestException, ConflictException } from '@nestjs/common';
import type { ExecutionEntity } from './execution.entity';
import { EXECUTION_UUID_PATTERN } from './execution.constants';
import type {
  OperationBudgetBucket,
  OperationBudgetGrant,
  OperationBudgetProjection,
  OperationBudgetReservation,
  ExactToolRepeatGuardState,
} from './execution-progress';
import type {
  OperationBudgetReservationRequest,
  ProgressGrantRequest,
} from './execution.types';

const CHAT_TASK_TYPES = new Set(['assistant-chat', 'agent-chat']);
const EXCLUDED_CHAT_INFERENCE_PHASES = new Set([
  'memory_extraction',
  'structured_output_repair',
]);
const INFERENCE_BUCKET_BY_PHASE: Record<string, OperationBudgetBucket> = {
  direct_response: 'normal',
  agent_loop: 'normal',
  output_repair: 'repair',
  forced_finalization: 'closing',
};
const TOOL_BUDGET_PHASES = new Set(['agent_loop', 'output_repair']);

export type OperationBudgetLimits = {
  normal: number;
  normalInferenceSoftLimit: number;
  repair: number;
  closing: number;
  maxTokensPerInference: number;
  toolCalls: number;
  toolCallSoftLimit: number;
  exactToolRepeatWarning: boolean;
  exactToolRepeatBlockAfterWarning: boolean;
  exactToolRepeatTerminateAfterBlock: boolean;
};

export type GovernedBudgetStart = {
  operationId: string;
  operationKind: 'inference' | 'tool_call';
  toolCallId?: string;
  grantId: string;
  reservationId: string;
  executionAttemptId: string;
  bucket: string;
  loopId: string;
  phase: string;
  round: number;
  name: string;
  budgetSoftLimitWarningApplied: boolean;
  operationFingerprint?: string;
  operationFingerprintVersion?: 'canonical_tool_input_v1';
  toolBatchSize?: number;
  toolBatchIndex?: number;
  loopGuardWarningApplied: boolean;
  loopGuardBlockResultApplied: boolean;
};

export function validateProgressGrantRequest(
  rootExecutionId: string,
  request: ProgressGrantRequest,
): void {
  for (const [name, value] of Object.entries({
    rootExecutionId,
    executionId: request?.executionId,
    turnId: request?.turnId,
    loopId: request?.loopId,
    executionAttemptId: request?.executionAttemptId,
  })) {
    if (!EXECUTION_UUID_PATTERN.test(String(value ?? ''))) {
      throw new BadRequestException(`${name} must be a UUID`);
    }
  }
  if (request?.loopKind !== 'top_level') {
    throw new BadRequestException('Only top-level loops receive a grant');
  }
  const policy = request?.requestedPolicy;
  if (
    !policy ||
    !Number.isInteger(policy.normal) ||
    policy.normal < 1 ||
    !Number.isInteger(policy.normalInferenceSoftLimit) ||
    policy.normalInferenceSoftLimit < 0 ||
    !Number.isInteger(policy.repair) ||
    policy.repair < 0 ||
    !Number.isInteger(policy.closing) ||
    policy.closing < 0 ||
    policy.closing > 1 ||
    !Number.isInteger(policy.maxTokensPerInference) ||
    policy.maxTokensPerInference < 1 ||
    !Number.isInteger(policy.toolCalls) ||
    policy.toolCalls < 0 ||
    !Number.isInteger(policy.toolCallSoftLimit) ||
    policy.toolCallSoftLimit < 0 ||
    (policy.exactToolRepeatWarning !== undefined &&
      typeof policy.exactToolRepeatWarning !== 'boolean') ||
    (policy.exactToolRepeatBlockAfterWarning !== undefined &&
      typeof policy.exactToolRepeatBlockAfterWarning !== 'boolean') ||
    (policy.exactToolRepeatTerminateAfterBlock !== undefined &&
      typeof policy.exactToolRepeatTerminateAfterBlock !== 'boolean') ||
    !String(request.agentName ?? '').trim()
  ) {
    throw new BadRequestException('Invalid progress grant request');
  }
}

export function validateReservationRequest(
  rootExecutionId: string,
  request: OperationBudgetReservationRequest,
): void {
  for (const [name, value] of Object.entries({
    rootExecutionId,
    executionId: request?.executionId,
    loopId: request?.loopId,
    grantId: request?.grantId,
    operationId: request?.operationId,
    executionAttemptId: request?.executionAttemptId,
  })) {
    if (!EXECUTION_UUID_PATTERN.test(String(value ?? ''))) {
      throw new BadRequestException(`${name} must be a UUID`);
    }
  }
  if (
    !['inference', 'tool_call'].includes(request?.operationKind) ||
    !['normal', 'repair', 'closing', 'tool'].includes(request?.bucket) ||
    !String(request?.phase ?? '').trim() ||
    !String(request?.name ?? '').trim() ||
    !Number.isInteger(request?.round) ||
    request.round < 1
  ) {
    throw new BadRequestException('Invalid operation budget reservation');
  }
  if (
    request.operationKind === 'tool_call' &&
    !EXECUTION_UUID_PATTERN.test(String(request.toolCallId ?? ''))
  ) {
    throw new BadRequestException('toolCallId must be a UUID');
  }
  if (
    request.operationKind === 'inference' &&
    (request.toolCallId !== undefined ||
      request.operationFingerprint !== undefined ||
      request.operationFingerprintVersion !== undefined ||
      request.toolBatchSize !== undefined ||
      request.toolBatchIndex !== undefined)
  ) {
    throw new BadRequestException(
      'Tool identity is only valid for tool budget reservations',
    );
  }
  const hasFingerprint = request.operationFingerprint !== undefined;
  const hasFingerprintVersion =
    request.operationFingerprintVersion !== undefined;
  const hasBatchSize = request.toolBatchSize !== undefined;
  const hasBatchIndex = request.toolBatchIndex !== undefined;
  if (
    hasFingerprint !== hasFingerprintVersion ||
    (hasFingerprint &&
      (!/^sha256:[0-9a-f]{64}$/.test(request.operationFingerprint!) ||
        request.operationFingerprintVersion !== 'canonical_tool_input_v1'))
  ) {
    throw new BadRequestException('Invalid tool operation fingerprint');
  }
  if (
    hasBatchSize !== hasBatchIndex ||
    (hasBatchSize &&
      (request.operationKind !== 'tool_call' ||
        !Number.isInteger(request.toolBatchSize) ||
        request.toolBatchSize! < 1 ||
        !Number.isInteger(request.toolBatchIndex) ||
        request.toolBatchIndex! < 0 ||
        request.toolBatchIndex! >= request.toolBatchSize!))
  ) {
    throw new BadRequestException('Invalid tool batch identity');
  }
}

export function assertGrantScope(
  execution: ExecutionEntity,
  request: ProgressGrantRequest,
): void {
  if (!CHAT_TASK_TYPES.has(execution.taskType)) {
    throw new BadRequestException(
      'Progress grants are only available for chat executions',
    );
  }
  if (
    request.executionId !== execution.executionId ||
    request.loopId !== execution.executionId ||
    request.turnId !== execution.turnId
  ) {
    throw new BadRequestException('Grant identity is outside execution scope');
  }
}

export function resolveEffectivePolicy(
  requested: ProgressGrantRequest['requestedPolicy'],
  limits: OperationBudgetLimits,
): ProgressGrantRequest['requestedPolicy'] {
  const normal = Math.min(requested.normal, limits.normal);
  const normalInferenceSoftLimit =
    normal <= 1 ||
    requested.normalInferenceSoftLimit === 0 ||
    limits.normalInferenceSoftLimit === 0
      ? 0
      : Math.max(
          1,
          Math.min(
            requested.normalInferenceSoftLimit,
            limits.normalInferenceSoftLimit,
            normal - 1,
          ),
        );
  const toolCalls = Math.min(requested.toolCalls, limits.toolCalls);
  const toolCallSoftLimit =
    toolCalls <= 1 ||
    requested.toolCallSoftLimit === 0 ||
    limits.toolCallSoftLimit === 0
      ? 0
      : Math.max(
          1,
          Math.min(
            requested.toolCallSoftLimit,
            limits.toolCallSoftLimit,
            toolCalls - 1,
          ),
        );
  return {
    normal,
    normalInferenceSoftLimit,
    repair: Math.min(requested.repair, limits.repair),
    closing: Math.min(requested.closing, limits.closing),
    maxTokensPerInference: Math.min(
      requested.maxTokensPerInference,
      limits.maxTokensPerInference,
    ),
    toolCalls,
    toolCallSoftLimit,
    exactToolRepeatWarning:
      requested.exactToolRepeatWarning === true &&
      limits.exactToolRepeatWarning,
    exactToolRepeatBlockAfterWarning:
      requested.exactToolRepeatWarning === true &&
      requested.exactToolRepeatBlockAfterWarning === true &&
      limits.exactToolRepeatWarning &&
      limits.exactToolRepeatBlockAfterWarning,
    exactToolRepeatTerminateAfterBlock:
      requested.exactToolRepeatWarning === true &&
      requested.exactToolRepeatBlockAfterWarning === true &&
      requested.exactToolRepeatTerminateAfterBlock === true &&
      limits.exactToolRepeatWarning &&
      limits.exactToolRepeatBlockAfterWarning &&
      limits.exactToolRepeatTerminateAfterBlock,
  };
}

export function createOperationBudgetGrant(
  execution: ExecutionEntity,
  request: ProgressGrantRequest,
  effectivePolicy: ProgressGrantRequest['requestedPolicy'],
  grantId: string,
  grantedAt: string,
): OperationBudgetGrant {
  return {
    version: '1',
    grantId,
    executionId: execution.executionId,
    turnId: execution.turnId,
    loopId: request.loopId,
    executionAttemptId: request.executionAttemptId,
    profileId: 'documents_chat_v1',
    policyVersion: '1',
    requestedPolicy: structuredClone(request.requestedPolicy),
    effectivePolicy,
    grantedAt,
  };
}

export function withoutGrantUsage(
  grant: OperationBudgetGrant & { usage?: unknown },
): OperationBudgetGrant {
  const value = {
    ...grant,
    requestedPolicy: {
      ...grant.requestedPolicy,
      normalInferenceSoftLimit:
        grant.requestedPolicy.normalInferenceSoftLimit ?? 0,
      toolCallSoftLimit: grant.requestedPolicy.toolCallSoftLimit ?? 0,
      exactToolRepeatWarning:
        grant.requestedPolicy.exactToolRepeatWarning ?? false,
      exactToolRepeatBlockAfterWarning:
        grant.requestedPolicy.exactToolRepeatBlockAfterWarning ?? false,
      exactToolRepeatTerminateAfterBlock:
        grant.requestedPolicy.exactToolRepeatTerminateAfterBlock ?? false,
    },
    effectivePolicy: {
      ...grant.effectivePolicy,
      normalInferenceSoftLimit:
        grant.effectivePolicy.normalInferenceSoftLimit ?? 0,
      toolCallSoftLimit: grant.effectivePolicy.toolCallSoftLimit ?? 0,
      exactToolRepeatWarning:
        grant.effectivePolicy.exactToolRepeatWarning ?? false,
      exactToolRepeatBlockAfterWarning:
        grant.effectivePolicy.exactToolRepeatBlockAfterWarning ?? false,
      exactToolRepeatTerminateAfterBlock:
        grant.effectivePolicy.exactToolRepeatTerminateAfterBlock ?? false,
    },
  };
  delete value.usage;
  return value;
}

export function assertReservationScope(
  execution: ExecutionEntity,
  request: OperationBudgetReservationRequest,
): void {
  if (
    request.executionId !== execution.executionId ||
    request.loopId !== execution.executionId
  ) {
    throw new BadRequestException(
      'Reservation identity is outside execution scope',
    );
  }
}

export function assertReservationMatches(
  reservation: OperationBudgetReservation,
  request: OperationBudgetReservationRequest,
): void {
  if (
    reservation.grantId !== request.grantId ||
    reservation.operationId !== request.operationId ||
    reservation.executionAttemptId !== request.executionAttemptId ||
    reservation.operationKind !== request.operationKind ||
    reservation.bucket !== request.bucket ||
    reservation.toolCallId !== request.toolCallId ||
    reservation.phase !== request.phase ||
    reservation.round !== request.round ||
    reservation.name !== request.name ||
    reservation.operationFingerprint !== request.operationFingerprint ||
    reservation.operationFingerprintVersion !==
      request.operationFingerprintVersion ||
    reservation.toolBatchSize !== request.toolBatchSize ||
    reservation.toolBatchIndex !== request.toolBatchIndex
  ) {
    throw new ConflictException(
      'operationId already belongs to another budget reservation',
    );
  }
}

export function assertBucketMatchesOperation(
  operationKind: 'inference' | 'tool_call',
  bucket: OperationBudgetBucket,
  phase: string,
): void {
  const expected =
    operationKind === 'tool_call' ? 'tool' : INFERENCE_BUCKET_BY_PHASE[phase];
  if (
    expected !== bucket ||
    (operationKind === 'tool_call' && !TOOL_BUDGET_PHASES.has(phase))
  ) {
    throw new BadRequestException(
      `Budget bucket ${bucket} cannot be used for ${operationKind} in phase ${phase}`,
    );
  }
}

export function createOperationBudgetReservation(
  request: OperationBudgetReservationRequest,
  granted: boolean,
  reservationId: string,
  decidedAt: string,
  deniedReason?: string,
): OperationBudgetReservation {
  return {
    version: '1',
    reservationId,
    grantId: request.grantId,
    operationId: request.operationId,
    executionAttemptId: request.executionAttemptId,
    operationKind: request.operationKind,
    bucket: request.bucket,
    ...(request.toolCallId ? { toolCallId: request.toolCallId } : {}),
    ...(request.operationFingerprint
      ? {
          operationFingerprint: request.operationFingerprint,
          operationFingerprintVersion: request.operationFingerprintVersion,
        }
      : {}),
    ...(request.toolBatchSize !== undefined
      ? {
          toolBatchSize: request.toolBatchSize,
          toolBatchIndex: request.toolBatchIndex,
        }
      : {}),
    phase: request.phase,
    round: request.round,
    name: request.name,
    status: granted ? 'reserved' : 'denied',
    ...(granted
      ? {}
      : {
          reason:
            deniedReason ??
            (request.operationKind === 'tool_call'
              ? 'tool_budget_hard_limit_reached'
              : 'budget_hard_limit_reached'),
        }),
    decidedAt,
  };
}

export function governedBudgetStart(
  execution: ExecutionEntity,
  event: Record<string, unknown>,
): GovernedBudgetStart | null {
  const payload = event.payload as Record<string, unknown> | undefined;
  const operationKind = payload?.operationKind;
  if (
    event.eventType !== 'operation.started' ||
    (operationKind !== 'inference' && operationKind !== 'tool_call')
  ) {
    return null;
  }
  const phase = String(payload.phase ?? '');
  const governed =
    CHAT_TASK_TYPES.has(execution.taskType) &&
    payload.loopKind !== 'synchronous_subagent' &&
    (operationKind === 'tool_call' ||
      !EXCLUDED_CHAT_INFERENCE_PHASES.has(phase));
  if (!governed) return null;
  const identity: GovernedBudgetStart = {
    operationId: String(event.operationId ?? ''),
    operationKind,
    ...(event.toolCallId ? { toolCallId: String(event.toolCallId) } : {}),
    grantId: String(payload.budgetGrantId ?? ''),
    reservationId: String(payload.budgetReservationId ?? ''),
    executionAttemptId: String(payload.executionAttemptId ?? ''),
    bucket: String(payload.budgetBucket ?? ''),
    loopId: String(payload.loopId ?? ''),
    phase,
    round: Number(payload.round),
    name: String(payload.name ?? ''),
    budgetSoftLimitWarningApplied:
      payload.budgetSoftLimitWarningApplied === true,
    ...(payload.operationFingerprint
      ? {
          operationFingerprint: String(payload.operationFingerprint),
          operationFingerprintVersion: String(
            payload.operationFingerprintVersion,
          ) as 'canonical_tool_input_v1',
        }
      : {}),
    ...(payload.toolBatchSize !== undefined
      ? {
          toolBatchSize: Number(payload.toolBatchSize),
          toolBatchIndex: Number(payload.toolBatchIndex),
        }
      : {}),
    loopGuardWarningApplied: payload.loopGuardWarningApplied === true,
    loopGuardBlockResultApplied: payload.loopGuardBlockResultApplied === true,
  };
  if (
    !EXECUTION_UUID_PATTERN.test(identity.grantId) ||
    !EXECUTION_UUID_PATTERN.test(identity.reservationId) ||
    !EXECUTION_UUID_PATTERN.test(identity.executionAttemptId) ||
    (operationKind === 'tool_call' &&
      !EXECUTION_UUID_PATTERN.test(identity.toolCallId ?? ''))
  ) {
    throw new ConflictException(
      `Top-level ${operationKind} has no valid budget reservation`,
    );
  }
  return identity;
}

export function assertOperationBudgetProjection(
  identity: GovernedBudgetStart,
  budget: OperationBudgetProjection | undefined,
  exactToolRepeatGuard?: ExactToolRepeatGuardState,
): void {
  const reservation = budget?.reservations[identity.operationId];
  const grant = budget?.grants[identity.grantId];
  if (
    !grant ||
    grant.loopId !== identity.loopId ||
    !reservation ||
    reservation.status !== 'reserved' ||
    reservation.grantId !== identity.grantId ||
    reservation.reservationId !== identity.reservationId ||
    reservation.executionAttemptId !== identity.executionAttemptId ||
    reservation.operationKind !== identity.operationKind ||
    reservation.toolCallId !== identity.toolCallId ||
    reservation.bucket !== identity.bucket ||
    reservation.phase !== identity.phase ||
    reservation.round !== identity.round ||
    reservation.name !== identity.name ||
    reservation.operationFingerprint !== identity.operationFingerprint ||
    reservation.operationFingerprintVersion !==
      identity.operationFingerprintVersion ||
    reservation.toolBatchSize !== identity.toolBatchSize ||
    reservation.toolBatchIndex !== identity.toolBatchIndex
  ) {
    throw new ConflictException(
      `Top-level ${identity.operationKind} budget reservation is invalid or consumed`,
    );
  }
  const normalUsage = grant.usage.normal;
  const warningRequired =
    identity.operationKind === 'inference' &&
    identity.bucket === 'normal' &&
    normalUsage.softLimitWarningPending === true;
  if (identity.budgetSoftLimitWarningApplied !== warningRequired) {
    throw new ConflictException(
      'Normal inference soft-limit warning does not match the durable budget state',
    );
  }
  const loopGuardWarningRequired =
    identity.operationKind === 'inference' &&
    identity.bucket === 'normal' &&
    exactToolRepeatGuard?.warningPending === true;
  if (identity.loopGuardWarningApplied !== loopGuardWarningRequired) {
    throw new ConflictException(
      'Loop guard warning does not match the durable progress state',
    );
  }
  const loopGuardBlockResultRequired =
    identity.operationKind === 'inference' &&
    identity.bucket === 'normal' &&
    exactToolRepeatGuard?.blockResultPending === true;
  if (identity.loopGuardBlockResultApplied !== loopGuardBlockResultRequired) {
    throw new ConflictException(
      'Loop guard block result does not match the durable progress state',
    );
  }
}

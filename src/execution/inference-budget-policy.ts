import { BadRequestException, ConflictException } from '@nestjs/common';
import type { ExecutionEntity } from './execution.entity';
import { ExecutionStatus } from './execution-status.enum';
import { EXECUTION_UUID_PATTERN } from './execution.constants';
import type {
  InferenceBudgetBucket,
  InferenceBudgetGrant,
  InferenceBudgetProjection,
  InferenceBudgetReservation,
} from './execution-progress';
import type {
  InferenceBudgetReservationRequest,
  ProgressGrantRequest,
} from './execution.types';

const CHAT_TASK_TYPES = new Set(['assistant-chat', 'agent-chat']);
const EXCLUDED_CHAT_INFERENCE_PHASES = new Set([
  'memory_extraction',
  'structured_output_repair',
]);
const BUCKET_BY_PHASE: Record<string, InferenceBudgetBucket> = {
  direct_response: 'normal',
  agent_loop: 'normal',
  output_repair: 'repair',
  forced_finalization: 'closing',
};

export type InferenceBudgetLimits = {
  normal: number;
  repair: number;
  closing: number;
  maxTokensPerInference: number;
};

export type GovernedInferenceStart = {
  operationId: string;
  grantId: string;
  reservationId: string;
  executionAttemptId: string;
  bucket: string;
  loopId: string;
  phase: string;
  round: number;
  name: string;
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
    !Number.isInteger(policy.repair) ||
    policy.repair < 0 ||
    !Number.isInteger(policy.closing) ||
    policy.closing < 0 ||
    policy.closing > 1 ||
    !Number.isInteger(policy.maxTokensPerInference) ||
    policy.maxTokensPerInference < 1 ||
    !String(request.agentName ?? '').trim()
  ) {
    throw new BadRequestException('Invalid progress grant request');
  }
}

export function validateReservationRequest(
  rootExecutionId: string,
  request: InferenceBudgetReservationRequest,
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
    !['normal', 'repair', 'closing'].includes(request?.bucket) ||
    !String(request?.phase ?? '').trim() ||
    !String(request?.name ?? '').trim() ||
    !Number.isInteger(request?.round) ||
    request.round < 1
  ) {
    throw new BadRequestException('Invalid inference budget reservation');
  }
}

export function assertActiveBudgetAttempt(
  execution: ExecutionEntity,
  attemptId: string,
): void {
  if (
    execution.status !== ExecutionStatus.RUNNING ||
    !execution.attemptId ||
    execution.attemptId !== attemptId
  ) {
    throw new ConflictException('Execution attempt is not active');
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
  limits: InferenceBudgetLimits,
): ProgressGrantRequest['requestedPolicy'] {
  return {
    normal: Math.min(requested.normal, limits.normal),
    repair: Math.min(requested.repair, limits.repair),
    closing: Math.min(requested.closing, limits.closing),
    maxTokensPerInference: Math.min(
      requested.maxTokensPerInference,
      limits.maxTokensPerInference,
    ),
  };
}

export function createInferenceBudgetGrant(
  execution: ExecutionEntity,
  request: ProgressGrantRequest,
  effectivePolicy: ProgressGrantRequest['requestedPolicy'],
  grantId: string,
  grantedAt: string,
): InferenceBudgetGrant {
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
  grant: InferenceBudgetGrant & { usage?: unknown },
): InferenceBudgetGrant {
  const value = { ...grant };
  delete value.usage;
  return value;
}

export function assertReservationScope(
  execution: ExecutionEntity,
  request: InferenceBudgetReservationRequest,
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
  reservation: InferenceBudgetReservation,
  request: InferenceBudgetReservationRequest,
): void {
  if (
    reservation.grantId !== request.grantId ||
    reservation.operationId !== request.operationId ||
    reservation.executionAttemptId !== request.executionAttemptId ||
    reservation.bucket !== request.bucket ||
    reservation.phase !== request.phase ||
    reservation.round !== request.round ||
    reservation.name !== request.name
  ) {
    throw new ConflictException(
      'operationId already belongs to another budget reservation',
    );
  }
}

export function assertBucketMatchesPhase(
  bucket: InferenceBudgetBucket,
  phase: string,
): void {
  if (BUCKET_BY_PHASE[phase] !== bucket) {
    throw new BadRequestException(
      `Budget bucket ${bucket} cannot be used for phase ${phase}`,
    );
  }
}

export function createInferenceBudgetReservation(
  request: InferenceBudgetReservationRequest,
  granted: boolean,
  reservationId: string,
  decidedAt: string,
): InferenceBudgetReservation {
  return {
    version: '1',
    reservationId,
    grantId: request.grantId,
    operationId: request.operationId,
    executionAttemptId: request.executionAttemptId,
    bucket: request.bucket,
    phase: request.phase,
    round: request.round,
    name: request.name,
    status: granted ? 'reserved' : 'denied',
    ...(granted ? {} : { reason: 'budget_hard_limit_reached' }),
    decidedAt,
  };
}

export function governedInferenceStart(
  execution: ExecutionEntity,
  event: Record<string, unknown>,
): GovernedInferenceStart | null {
  const payload = event.payload as Record<string, unknown> | undefined;
  if (
    event.eventType !== 'operation.started' ||
    payload?.operationKind !== 'inference'
  ) {
    return null;
  }
  const phase = String(payload.phase ?? '');
  const governed =
    CHAT_TASK_TYPES.has(execution.taskType) &&
    payload.loopKind !== 'synchronous_subagent' &&
    !EXCLUDED_CHAT_INFERENCE_PHASES.has(phase);
  if (!governed) return null;
  const identity: GovernedInferenceStart = {
    operationId: String(event.operationId ?? ''),
    grantId: String(payload.budgetGrantId ?? ''),
    reservationId: String(payload.budgetReservationId ?? ''),
    executionAttemptId: String(payload.executionAttemptId ?? ''),
    bucket: String(payload.budgetBucket ?? ''),
    loopId: String(payload.loopId ?? ''),
    phase,
    round: Number(payload.round),
    name: String(payload.name ?? ''),
  };
  if (
    !EXECUTION_UUID_PATTERN.test(identity.grantId) ||
    !EXECUTION_UUID_PATTERN.test(identity.reservationId) ||
    !EXECUTION_UUID_PATTERN.test(identity.executionAttemptId) ||
    execution.attemptId !== identity.executionAttemptId
  ) {
    throw new ConflictException(
      'Top-level inference has no valid budget reservation',
    );
  }
  return identity;
}

export function assertInferenceBudgetProjection(
  identity: GovernedInferenceStart,
  budget: InferenceBudgetProjection | undefined,
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
    reservation.bucket !== identity.bucket ||
    reservation.phase !== identity.phase ||
    reservation.round !== identity.round ||
    reservation.name !== identity.name
  ) {
    throw new ConflictException(
      'Top-level inference budget reservation is invalid or consumed',
    );
  }
}

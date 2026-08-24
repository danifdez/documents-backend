import { ConflictException } from '@nestjs/common';
import { ExecutionStepAttemptStatus } from './execution-step-attempt-status.enum';
import { ExecutionStepStatus } from './execution-step-status.enum';

const STEP_TRANSITIONS: Record<ExecutionStepStatus, ExecutionStepStatus[]> = {
  [ExecutionStepStatus.BLOCKED]: [
    ExecutionStepStatus.READY,
    ExecutionStepStatus.CANCELLED,
  ],
  [ExecutionStepStatus.READY]: [
    ExecutionStepStatus.RUNNING,
    ExecutionStepStatus.FAILED,
    ExecutionStepStatus.CANCELLED,
  ],
  [ExecutionStepStatus.RUNNING]: [
    ExecutionStepStatus.RESULT_RECEIVED,
    ExecutionStepStatus.READY,
    ExecutionStepStatus.FAILED,
    ExecutionStepStatus.CANCELLED,
  ],
  [ExecutionStepStatus.RESULT_RECEIVED]: [
    ExecutionStepStatus.COMPLETED,
    ExecutionStepStatus.READY,
    ExecutionStepStatus.FAILED,
    ExecutionStepStatus.CANCELLED,
  ],
  [ExecutionStepStatus.COMPLETED]: [],
  [ExecutionStepStatus.FAILED]: [],
  [ExecutionStepStatus.CANCELLED]: [],
};

const ATTEMPT_TRANSITIONS: Record<
  ExecutionStepAttemptStatus,
  ExecutionStepAttemptStatus[]
> = {
  [ExecutionStepAttemptStatus.LEASED]: [
    ExecutionStepAttemptStatus.RUNNING,
    ExecutionStepAttemptStatus.EXPIRED,
    ExecutionStepAttemptStatus.CANCELLED,
    ExecutionStepAttemptStatus.FAILED,
  ],
  [ExecutionStepAttemptStatus.RUNNING]: [
    ExecutionStepAttemptStatus.RESULT_RECEIVED,
    ExecutionStepAttemptStatus.EXPIRED,
    ExecutionStepAttemptStatus.CANCELLED,
    ExecutionStepAttemptStatus.FAILED,
  ],
  [ExecutionStepAttemptStatus.RESULT_RECEIVED]: [
    ExecutionStepAttemptStatus.CLOSED,
  ],
  [ExecutionStepAttemptStatus.EXPIRED]: [],
  [ExecutionStepAttemptStatus.CANCELLED]: [],
  [ExecutionStepAttemptStatus.FAILED]: [],
  [ExecutionStepAttemptStatus.CLOSED]: [],
};

export function assertStepTransition(
  from: ExecutionStepStatus,
  to: ExecutionStepStatus,
): void {
  if (!STEP_TRANSITIONS[from]?.includes(to)) {
    throw new ConflictException(`invalid_step_transition:${from}:${to}`);
  }
}

export function assertAttemptTransition(
  from: ExecutionStepAttemptStatus,
  to: ExecutionStepAttemptStatus,
): void {
  if (!ATTEMPT_TRANSITIONS[from]?.includes(to)) {
    throw new ConflictException(`invalid_attempt_transition:${from}:${to}`);
  }
}

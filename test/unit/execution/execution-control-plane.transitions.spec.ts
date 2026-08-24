import { ConflictException } from '@nestjs/common';
import {
  assertAttemptTransition,
  assertStepTransition,
} from '../../../src/execution/execution-control-plane.transitions';
import { ExecutionStepAttemptStatus } from '../../../src/execution/execution-step-attempt-status.enum';
import { ExecutionStepStatus } from '../../../src/execution/execution-step-status.enum';

describe('execution control plane transitions', () => {
  it('allows the durable receipt boundary before semantic completion', () => {
    expect(() =>
      assertStepTransition(
        ExecutionStepStatus.RUNNING,
        ExecutionStepStatus.RESULT_RECEIVED,
      ),
    ).not.toThrow();
    expect(() =>
      assertStepTransition(
        ExecutionStepStatus.RESULT_RECEIVED,
        ExecutionStepStatus.COMPLETED,
      ),
    ).not.toThrow();
  });

  it('keeps terminal step states immutable', () => {
    expect(() =>
      assertStepTransition(
        ExecutionStepStatus.COMPLETED,
        ExecutionStepStatus.READY,
      ),
    ).toThrow(ConflictException);
  });

  it('allows an active attempt to expire and be fenced', () => {
    expect(() =>
      assertAttemptTransition(
        ExecutionStepAttemptStatus.RUNNING,
        ExecutionStepAttemptStatus.EXPIRED,
      ),
    ).not.toThrow();
  });

  it('does not revive a closed attempt', () => {
    expect(() =>
      assertAttemptTransition(
        ExecutionStepAttemptStatus.CLOSED,
        ExecutionStepAttemptStatus.RUNNING,
      ),
    ).toThrow(ConflictException);
  });
});

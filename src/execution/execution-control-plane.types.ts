import { ExecutionArtifactRef } from './execution-step.entity';
import { ExecutionStepKind } from './execution-step-kind.enum';

export interface CreateExecutionStepInput {
  executionId: string;
  stepId?: string;
  stepKind: ExecutionStepKind;
  dependsOnStepIds?: string[];
  inputArtifactRefs?: ExecutionArtifactRef[];
  work: Record<string, unknown>;
  requiredCapabilities?: string[];
  resourceKeys?: string[];
  budgetReservationId?: string | null;
  priority?: number;
  availableAt?: Date;
  deadline?: Date | null;
  operationId?: string;
}

export interface GrantExecutionStepAttemptInput {
  stepId: string;
  workerId: string;
  leaseDurationMs: number;
}

export interface ClaimExecutionStepInput {
  workerId: string;
  stepKinds: ExecutionStepKind[];
  capabilities: string[];
  leaseDurationMs: number;
}

export interface StepAssignment {
  schemaVersion: 'step-assignment/1';
  executionId: string;
  stepId: string;
  operationId: string;
  attemptId: string;
  stepKind: ExecutionStepKind;
  dependsOnStepIds: string[];
  inputArtifactRefs: ExecutionArtifactRef[];
  work: Record<string, unknown>;
  limits: { maxDurationMs: number };
  deadline: string;
}

export interface ReceiveExecutionStepResultInput {
  executionId: string;
  stepId: string;
  operationId: string;
  attemptId: string;
  workerId: string;
  result: Record<string, unknown>;
}

export type StepResultAckCode =
  'received' | 'duplicate' | 'stale_attempt' | 'result_conflict' | 'rejected';

export interface StepResultReceiptAck {
  schemaVersion: 'step-result-ack/1';
  executionId: string;
  stepId: string;
  operationId: string;
  attemptId: string;
  code: StepResultAckCode;
  receiptId?: string;
  acknowledgedAt: Date;
}

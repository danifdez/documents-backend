import { ExecutionOperationStatus } from '../execution/execution-operation-status.enum';
import { ExecutionStatus } from '../execution/execution-status.enum';
import { ExecutionStepKind } from '../execution/execution-step-kind.enum';
import { ExecutionStepStatus } from '../execution/execution-step-status.enum';
import { COORDINATION_PENDING_PHASE } from '../execution/execution.constants';

export type TerminalCandidateBlocker =
  | 'execution_not_pending'
  | 'cancellation_requested'
  | 'no_steps'
  | 'active_steps'
  | 'pending_continuation'
  | 'pending_repair'
  | 'pending_confirmation'
  | 'unmaterialized_tool_plan'
  | 'active_child'
  | 'unresolved_operation'
  | 'missing_result';

export interface TerminalCandidateSnapshot {
  status: ExecutionStatus;
  phase: string | null;
  cancellationRequested: boolean;
  result: unknown;
  steps: Array<{
    stepId: string;
    stepKind: ExecutionStepKind;
    status: ExecutionStepStatus;
    result: unknown;
    continuationProcessed: boolean;
    continuationStepId: string | null;
    terminalCandidatePrepared: boolean;
  }>;
  operationStatuses: ExecutionOperationStatus[];
  pendingConfirmations: number;
  unmaterializedToolPlans: number;
  activeChildren: number;
}

export type TerminalCandidateDecision =
  | { kind: 'blocked'; blockers: TerminalCandidateBlocker[] }
  | {
      kind: 'ready';
      completionKind: 'full' | 'partial';
      completionReason: string;
      evidenceStepIds: string[];
    };

const ACTIVE_STEP_STATUSES = new Set<ExecutionStepStatus>([
  ExecutionStepStatus.BLOCKED,
  ExecutionStepStatus.READY,
  ExecutionStepStatus.RUNNING,
  ExecutionStepStatus.RESULT_RECEIVED,
]);

const UNRESOLVED_OPERATION_STATUSES = new Set<ExecutionOperationStatus>([
  ExecutionOperationStatus.PLANNED,
  ExecutionOperationStatus.PREPARED,
  ExecutionOperationStatus.DISPATCHED,
  ExecutionOperationStatus.UNKNOWN,
]);

function outcomeKind(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const outcome = (value as Record<string, unknown>).outcome;
  return outcome && typeof outcome === 'object'
    ? String((outcome as Record<string, unknown>).kind ?? '') || null
    : null;
}

export function selectTerminalCandidate(
  snapshot: TerminalCandidateSnapshot,
): TerminalCandidateDecision {
  const blockers: TerminalCandidateBlocker[] = [];
  if (
    snapshot.status !== ExecutionStatus.RUNNING ||
    snapshot.phase !== COORDINATION_PENDING_PHASE
  ) {
    blockers.push('execution_not_pending');
  }
  if (snapshot.cancellationRequested) blockers.push('cancellation_requested');
  if (!snapshot.steps.length) blockers.push('no_steps');
  if (snapshot.steps.some((step) => ACTIVE_STEP_STATUSES.has(step.status))) {
    blockers.push('active_steps');
  }
  if (
    snapshot.steps.some(
      (step) =>
        step.stepKind === ExecutionStepKind.INFERENCE &&
        step.status === ExecutionStepStatus.COMPLETED &&
        outcomeKind(step.result) === 'tool_requests' &&
        (!step.continuationProcessed ||
          (!step.continuationStepId && !step.terminalCandidatePrepared)),
    )
  ) {
    blockers.push('pending_continuation');
  }
  if (
    snapshot.steps.some(
      (step) =>
        step.stepKind === ExecutionStepKind.INFERENCE &&
        step.status === ExecutionStepStatus.COMPLETED &&
        outcomeKind(step.result) === 'invalid' &&
        !step.terminalCandidatePrepared,
    )
  ) {
    blockers.push('pending_repair');
  }
  if (snapshot.pendingConfirmations > 0) {
    blockers.push('pending_confirmation');
  }
  if (snapshot.unmaterializedToolPlans > 0) {
    blockers.push('unmaterialized_tool_plan');
  }
  if (snapshot.activeChildren > 0) blockers.push('active_child');
  if (
    snapshot.operationStatuses.some((status) =>
      UNRESOLVED_OPERATION_STATUSES.has(status),
    )
  ) {
    blockers.push('unresolved_operation');
  }
  if (snapshot.result === null || snapshot.result === undefined) {
    blockers.push('missing_result');
  }
  if (blockers.length) return { kind: 'blocked', blockers };

  const result = snapshot.result as Record<string, unknown>;
  const completionKind =
    result && typeof result === 'object' && result.completionKind === 'partial'
      ? 'partial'
      : 'full';
  const completionReason =
    result &&
    typeof result === 'object' &&
    typeof result.completionReason === 'string' &&
    result.completionReason.trim()
      ? result.completionReason
      : 'goal_satisfied';
  return {
    kind: 'ready',
    completionKind,
    completionReason,
    evidenceStepIds: snapshot.steps
      .filter((step) => step.status === ExecutionStepStatus.COMPLETED)
      .map((step) => step.stepId),
  };
}

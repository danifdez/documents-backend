export const EXECUTION_AGE_PRIORITY_INTERVAL_SECONDS = 60;
export const EXECUTION_DEADLINE_URGENCY_SECONDS = 5 * 60;

export interface ExecutionSchedulingCandidate {
  priority: number;
  availableAt: Date;
  deadline: Date | null;
}

export function executionSchedulingScore(
  candidate: ExecutionSchedulingCandidate,
  now: Date,
): number {
  const ageSeconds = Math.max(
    0,
    Math.floor((now.getTime() - candidate.availableAt.getTime()) / 1_000),
  );
  const ageBoost = Math.floor(
    ageSeconds / EXECUTION_AGE_PRIORITY_INTERVAL_SECONDS,
  );
  const deadlineBoost = candidate.deadline
    ? Math.max(
        0,
        Math.floor(
          EXECUTION_DEADLINE_URGENCY_SECONDS -
            (candidate.deadline.getTime() - now.getTime()) / 1_000,
        ),
      )
    : 0;
  return candidate.priority + ageBoost + deadlineBoost;
}

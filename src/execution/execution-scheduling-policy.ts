import { ExecutionPriority } from './execution-priority.enum';

export const EXECUTION_AGE_PRIORITY_INTERVAL_SECONDS = 60;
export const EXECUTION_DEADLINE_URGENCY_SECONDS = 5 * 60;

export const EXECUTION_STEP_PRIORITY: Record<ExecutionPriority, number> = {
  [ExecutionPriority.HIGH]: 100,
  [ExecutionPriority.NORMAL]: 0,
  [ExecutionPriority.BACKGROUND]: -100,
};

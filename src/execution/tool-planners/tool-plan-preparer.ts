import { ExecutionEntity } from '../execution.entity';
import {
  ToolInvocationContract,
  ToolPlanContract,
} from '../execution-tool.types';

export const PLAN_TIMEOUT_MS = 30_000;
export const CONFIRMATION_TIMEOUT_MS = 15 * 60_000;
export const DELEGATION_TIMEOUT_MS = 10 * 60_000;
export const BROWSER_READ_TIMEOUT_MS = 2 * 60_000;
export const BROWSER_TASK_TIMEOUT_MS = 30 * 60_000;

export type ToolPlanPreparer = (
  invocation: ToolInvocationContract,
  execution: ExecutionEntity,
) => ToolPlanContract;

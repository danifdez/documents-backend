import { randomUUID } from 'crypto';
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

type ToolPlanDraft = Omit<
  ToolPlanContract,
  | 'schemaVersion'
  | 'operationId'
  | 'toolCallId'
  | 'toolName'
  | 'descriptorVersion'
  | 'deadline'
  | 'preparedAt'
>;

export interface ToolPlanIdentity {
  toolName: string;
  descriptorVersion: string;
  timeoutMs: number;
}

export function buildToolPlan(
  invocation: ToolInvocationContract,
  identity: ToolPlanIdentity,
  plan: ToolPlanDraft,
  preparedAt: Date = new Date(),
): ToolPlanContract {
  return {
    schemaVersion: 'tool-plan/1',
    operationId: randomUUID(),
    toolCallId: invocation.toolCallId,
    toolName: identity.toolName,
    descriptorVersion: identity.descriptorVersion,
    ...plan,
    deadline: new Date(preparedAt.getTime() + identity.timeoutMs).toISOString(),
    preparedAt: preparedAt.toISOString(),
  };
}

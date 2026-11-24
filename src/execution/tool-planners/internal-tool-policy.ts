import { randomUUID } from 'node:crypto';
import {
  AGENT_DELEGATE_TOOL_NAME,
  DOCUMENT_SEARCH_TOOL_NAME,
  SKILL_RESOURCE_LOAD_TOOL_NAME,
  USER_TASK_CREATE_TOOL_NAME,
} from '../execution-tool.constants';
import { ToolPlanContract } from '../execution-tool.types';
import { CONFIRMATION_TIMEOUT_MS } from './tool-plan-preparer';

type InternalToolPolicyInput =
  | {
      toolName:
        | typeof DOCUMENT_SEARCH_TOOL_NAME
        | typeof SKILL_RESOURCE_LOAD_TOOL_NAME
        | typeof AGENT_DELEGATE_TOOL_NAME;
    }
  | {
      toolName: typeof USER_TASK_CREATE_TOOL_NAME;
      title: string;
      preparedAt: Date;
    };

export function resolveInternalToolPolicy(
  input: InternalToolPolicyInput,
): Pick<ToolPlanContract, 'policyDecision' | 'confirmationRequirement'> {
  switch (input.toolName) {
    case DOCUMENT_SEARCH_TOOL_NAME:
      return {
        policyDecision: { decision: 'allowed', rule: 'local_documents_read' },
        confirmationRequirement: null,
      };
    case SKILL_RESOURCE_LOAD_TOOL_NAME:
      return {
        policyDecision: {
          decision: 'allowed',
          rule: 'active_product_skill_resource_read',
        },
        confirmationRequirement: null,
      };
    case AGENT_DELEGATE_TOOL_NAME:
      return {
        policyDecision: {
          decision: 'allowed',
          // The child stays in the owner's execution tree and runs one inference.
          rule: 'bounded_internal_delegation',
          conditions: ['max_depth_1', 'single_inference', 'join_all'],
        },
        confirmationRequirement: null,
      };
    case USER_TASK_CREATE_TOOL_NAME: {
      const expiresAt = new Date(
        input.preparedAt.getTime() + CONFIRMATION_TIMEOUT_MS,
      ).toISOString();
      return {
        policyDecision: {
          decision: 'confirmation_required',
          rule: 'user_task_create_requires_confirmation',
          expiresAt,
        },
        confirmationRequirement: {
          confirmationId: randomUUID(),
          reason: 'Creating a task changes local workspace data.',
          prompt: `Create the task "${input.title}"?`,
          scope: 'once',
          expiresAt,
        },
      };
    }
  }
}

import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { resolveProductSkillResource } from '../../conversation/product-skill-registry';
import { ExecutionEntity } from '../execution.entity';
import type { ChatExecutionPayload } from '../execution-task-payload.types';
import {
  AGENT_DELEGATE_TOOL_CAPABILITY,
  AGENT_DELEGATE_TOOL_NAME,
  AGENT_DELEGATE_TOOL_VERSION,
  DOCUMENT_SEARCH_TOOL_CAPABILITY,
  DOCUMENT_SEARCH_TOOL_NAME,
  DOCUMENT_SEARCH_TOOL_VERSION,
  SKILL_RESOURCE_LOAD_TOOL_CAPABILITY,
  SKILL_RESOURCE_LOAD_TOOL_NAME,
  SKILL_RESOURCE_LOAD_TOOL_VERSION,
  USER_TASK_CREATE_TOOL_CAPABILITY,
  USER_TASK_CREATE_TOOL_NAME,
  USER_TASK_CREATE_TOOL_VERSION,
} from '../execution-tool.constants';
import {
  ToolInvocationContract,
  ToolPlanContract,
} from '../execution-tool.types';
import {
  CONFIRMATION_TIMEOUT_MS,
  DELEGATION_TIMEOUT_MS,
  PLAN_TIMEOUT_MS,
  ToolPlanPreparer,
} from './tool-plan-preparer';

function chatPayload(execution: ExecutionEntity): ChatExecutionPayload {
  if (
    execution.taskType !== 'assistant-chat' &&
    execution.taskType !== 'agent-chat'
  ) {
    throw new BadRequestException('invalid_chat_execution_type');
  }
  return execution.payload as ChatExecutionPayload;
}

function prepareDocumentsSearch(
  invocation: ToolInvocationContract,
): ToolPlanContract {
  if (invocation.executionContext.dataClassification === 'secret') {
    throw new BadRequestException('data_policy_violation');
  }
  const keys = Object.keys(invocation.arguments);
  if (keys.some((key) => !['query', 'limit'].includes(key))) {
    throw new BadRequestException('invalid_arguments');
  }
  const query = String(invocation.arguments.query ?? '').trim();
  if (!query || query.length > 1_000) {
    throw new BadRequestException('invalid_arguments');
  }
  const requestedLimit = invocation.arguments.limit ?? 10;
  if (!Number.isInteger(requestedLimit)) {
    throw new BadRequestException('invalid_arguments');
  }
  const limit = Math.min(50, Math.max(1, Number(requestedLimit)));
  const preparedAt = new Date();
  return {
    schemaVersion: 'tool-plan/1',
    operationId: randomUUID(),
    toolCallId: invocation.toolCallId,
    toolName: DOCUMENT_SEARCH_TOOL_NAME,
    descriptorVersion: DOCUMENT_SEARCH_TOOL_VERSION,
    normalizedArguments: { query, limit },
    resources: [
      {
        resourceKey: 'documents:collection',
        mode: 'shared',
        kind: 'document_collection',
      },
    ],
    effects: [],
    policyDecision: { decision: 'allowed', rule: 'local_documents_read' },
    confirmationRequirement: null,
    recoveryClass: 'read_only_replayable',
    idempotencyKey: null,
    requiredCapabilities: [DOCUMENT_SEARCH_TOOL_CAPABILITY],
    deadline: new Date(preparedAt.getTime() + PLAN_TIMEOUT_MS).toISOString(),
    preparedAt: preparedAt.toISOString(),
  };
}

function prepareSkillResourceLoad(
  invocation: ToolInvocationContract,
  execution: ExecutionEntity,
): ToolPlanContract {
  const payload = chatPayload(execution);
  if (invocation.executionContext.dataClassification === 'secret') {
    throw new BadRequestException('data_policy_violation');
  }
  if (
    Object.keys(invocation.arguments).some(
      (key) =>
        ![
          'skillId',
          'skillVersion',
          'skillContentHash',
          'resourceId',
          'resourceContentHash',
        ].includes(key),
    )
  ) {
    throw new BadRequestException('invalid_arguments');
  }
  const identity = {
    skillId: invocation.arguments.skillId,
    skillVersion: invocation.arguments.skillVersion,
    skillContentHash: invocation.arguments.skillContentHash,
    resourceId: invocation.arguments.resourceId,
    resourceContentHash: invocation.arguments.resourceContentHash,
  };
  const selectedSkills = Array.isArray(payload.activeCapabilities?.skills)
    ? payload.activeCapabilities.skills
    : [];
  const selected = selectedSkills.some(
    (skill) =>
      skill.skillId === identity.skillId &&
      skill.version === identity.skillVersion &&
      skill.contentHash === identity.skillContentHash &&
      Array.isArray(skill.resources) &&
      skill.resources.some(
        (resource) =>
          resource.resourceId === identity.resourceId &&
          resource.contentHash === identity.resourceContentHash,
      ),
  );
  const resource = resolveProductSkillResource(identity);
  if (!selected || !resource) {
    throw new BadRequestException('skill_resource_not_active');
  }
  const preparedAt = new Date();
  const resourceKey = [
    'product-skill',
    resource.skillVersion,
    resource.resourceId,
    resource.contentHash,
  ].join(':');
  return {
    schemaVersion: 'tool-plan/1',
    operationId: randomUUID(),
    toolCallId: invocation.toolCallId,
    toolName: SKILL_RESOURCE_LOAD_TOOL_NAME,
    descriptorVersion: SKILL_RESOURCE_LOAD_TOOL_VERSION,
    normalizedArguments: identity as Record<string, unknown>,
    resources: [
      {
        resourceKey,
        mode: 'shared',
        kind: 'product_skill_resource',
        id: resource.resourceId,
        version: resource.contentHash,
      },
    ],
    effects: [],
    policyDecision: {
      decision: 'allowed',
      rule: 'active_product_skill_resource_read',
    },
    confirmationRequirement: null,
    recoveryClass: 'read_only_replayable',
    idempotencyKey: null,
    requiredCapabilities: [SKILL_RESOURCE_LOAD_TOOL_CAPABILITY],
    deadline: new Date(preparedAt.getTime() + PLAN_TIMEOUT_MS).toISOString(),
    preparedAt: preparedAt.toISOString(),
  };
}

function prepareUserTaskCreate(
  invocation: ToolInvocationContract,
): ToolPlanContract {
  if (invocation.executionContext.dataClassification === 'secret') {
    throw new BadRequestException('data_policy_violation');
  }
  const keys = Object.keys(invocation.arguments);
  if (keys.some((key) => !['title', 'description'].includes(key))) {
    throw new BadRequestException('invalid_arguments');
  }
  const title = String(invocation.arguments.title ?? '').trim();
  if (!title || title.length > 200) {
    throw new BadRequestException('invalid_arguments');
  }
  const rawDescription = invocation.arguments.description;
  if (rawDescription !== undefined && typeof rawDescription !== 'string') {
    throw new BadRequestException('invalid_arguments');
  }
  const description =
    typeof rawDescription === 'string' ? rawDescription.trim() || null : null;
  if (description && description.length > 4_000) {
    throw new BadRequestException('invalid_arguments');
  }
  const preparedAt = new Date();
  const expiresAt = new Date(preparedAt.getTime() + CONFIRMATION_TIMEOUT_MS);
  return {
    schemaVersion: 'tool-plan/1',
    operationId: randomUUID(),
    toolCallId: invocation.toolCallId,
    toolName: USER_TASK_CREATE_TOOL_NAME,
    descriptorVersion: USER_TASK_CREATE_TOOL_VERSION,
    normalizedArguments: { title, description },
    resources: [
      {
        resourceKey: 'user-tasks:collection',
        mode: 'exclusive',
        kind: 'user_task_collection',
      },
    ],
    effects: [
      {
        effectClass: 'local_reversible',
        resourceKey: 'user-tasks:collection',
        description: `Create task: ${title}`,
        reversible: true,
        verificationRequired: true,
      },
    ],
    policyDecision: {
      decision: 'confirmation_required',
      rule: 'user_task_create_requires_confirmation',
      expiresAt: expiresAt.toISOString(),
    },
    confirmationRequirement: {
      confirmationId: randomUUID(),
      reason: 'Creating a task changes local workspace data.',
      prompt: `Create the task "${title}"?`,
      scope: 'once',
      expiresAt: expiresAt.toISOString(),
    },
    recoveryClass: 'effect_checked',
    idempotencyKey: `user-task:${invocation.toolCallId}`,
    requiredCapabilities: [USER_TASK_CREATE_TOOL_CAPABILITY],
    deadline: expiresAt.toISOString(),
    preparedAt: preparedAt.toISOString(),
  };
}

function prepareAgentDelegation(
  invocation: ToolInvocationContract,
): ToolPlanContract {
  if (invocation.executionContext.dataClassification === 'secret') {
    throw new BadRequestException('data_policy_violation');
  }
  if (Object.keys(invocation.arguments).some((key) => key !== 'goal')) {
    throw new BadRequestException('invalid_arguments');
  }
  const goal = String(invocation.arguments.goal ?? '').trim();
  if (!goal || goal.length > 4_000) {
    throw new BadRequestException('invalid_arguments');
  }
  const preparedAt = new Date();
  return {
    schemaVersion: 'tool-plan/1',
    operationId: randomUUID(),
    toolCallId: invocation.toolCallId,
    toolName: AGENT_DELEGATE_TOOL_NAME,
    descriptorVersion: AGENT_DELEGATE_TOOL_VERSION,
    normalizedArguments: { goal },
    resources: [
      {
        resourceKey: `execution-tree:${invocation.executionContext.executionId}`,
        mode: 'shared',
        kind: 'execution_tree',
      },
    ],
    effects: [],
    policyDecision: {
      decision: 'allowed',
      rule: 'bounded_internal_delegation',
      conditions: ['max_depth_1', 'single_inference', 'join_all'],
    },
    confirmationRequirement: null,
    recoveryClass: 'idempotent',
    idempotencyKey: `delegation:${invocation.toolCallId}`,
    requiredCapabilities: [AGENT_DELEGATE_TOOL_CAPABILITY],
    deadline: new Date(
      preparedAt.getTime() + DELEGATION_TIMEOUT_MS,
    ).toISOString(),
    preparedAt: preparedAt.toISOString(),
  };
}

export const INTERNAL_TOOL_PLAN_PREPARERS: ReadonlyArray<
  readonly [string, ToolPlanPreparer]
> = [
  [DOCUMENT_SEARCH_TOOL_NAME, prepareDocumentsSearch],
  [SKILL_RESOURCE_LOAD_TOOL_NAME, prepareSkillResourceLoad],
  [USER_TASK_CREATE_TOOL_NAME, prepareUserTaskCreate],
  [AGENT_DELEGATE_TOOL_NAME, prepareAgentDelegation],
];

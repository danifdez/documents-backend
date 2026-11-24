import { readString } from '../../utils/read-string';
import { BadRequestException } from '@nestjs/common';
import { resolveProductSkillResource } from '../../conversation/product-skill-registry';
import { ExecutionEntity } from '../execution.entity';
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
  assertToolDataClassification,
  buildToolPlan,
  chatTurnPayload,
} from './tool-plan-preparer';
import { resolveInternalToolPolicy } from './internal-tool-policy';

function prepareDocumentsSearch(
  invocation: ToolInvocationContract,
): ToolPlanContract {
  assertToolDataClassification(invocation);
  const keys = Object.keys(invocation.arguments);
  if (keys.some((key) => !['query', 'limit'].includes(key))) {
    throw new BadRequestException('invalid_arguments');
  }
  const query = readString(invocation.arguments.query).trim();
  if (!query || query.length > 1_000) {
    throw new BadRequestException('invalid_arguments');
  }
  const requestedLimit = invocation.arguments.limit ?? 10;
  if (!Number.isInteger(requestedLimit)) {
    throw new BadRequestException('invalid_arguments');
  }
  const limit = Math.min(50, Math.max(1, Number(requestedLimit)));
  return buildToolPlan(
    invocation,
    {
      toolName: DOCUMENT_SEARCH_TOOL_NAME,
      descriptorVersion: DOCUMENT_SEARCH_TOOL_VERSION,
      timeoutMs: PLAN_TIMEOUT_MS,
    },
    {
      normalizedArguments: { query, limit },
      resources: [
        {
          resourceKey: 'documents:collection',
          mode: 'shared',
          kind: 'document_collection',
        },
      ],
      effects: [],
      ...resolveInternalToolPolicy({ toolName: DOCUMENT_SEARCH_TOOL_NAME }),
      recoveryClass: 'read_only_replayable',
      idempotencyKey: null,
      requiredCapabilities: [DOCUMENT_SEARCH_TOOL_CAPABILITY],
    },
  );
}

function resolveActiveSkillResource(
  invocation: ToolInvocationContract,
  execution: ExecutionEntity,
) {
  const payload = chatTurnPayload(execution);
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
  return { identity, resource };
}

function prepareSkillResourceLoad(
  invocation: ToolInvocationContract,
  execution: ExecutionEntity,
): ToolPlanContract {
  assertToolDataClassification(invocation);
  const { identity, resource } = resolveActiveSkillResource(
    invocation,
    execution,
  );
  const resourceKey = [
    'product-skill',
    resource.skillVersion,
    resource.resourceId,
    resource.contentHash,
  ].join(':');
  return buildToolPlan(
    invocation,
    {
      toolName: SKILL_RESOURCE_LOAD_TOOL_NAME,
      descriptorVersion: SKILL_RESOURCE_LOAD_TOOL_VERSION,
      timeoutMs: PLAN_TIMEOUT_MS,
    },
    {
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
      ...resolveInternalToolPolicy({ toolName: SKILL_RESOURCE_LOAD_TOOL_NAME }),
      recoveryClass: 'read_only_replayable',
      idempotencyKey: null,
      requiredCapabilities: [SKILL_RESOURCE_LOAD_TOOL_CAPABILITY],
    },
  );
}

function normalizeUserTaskCreate(invocation: ToolInvocationContract) {
  const keys = Object.keys(invocation.arguments);
  if (keys.some((key) => !['title', 'description'].includes(key))) {
    throw new BadRequestException('invalid_arguments');
  }
  const title = readString(invocation.arguments.title).trim();
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
  return { title, description };
}

function prepareUserTaskCreate(
  invocation: ToolInvocationContract,
): ToolPlanContract {
  assertToolDataClassification(invocation);
  const { title, description } = normalizeUserTaskCreate(invocation);
  const preparedAt = new Date();
  return buildToolPlan(
    invocation,
    {
      toolName: USER_TASK_CREATE_TOOL_NAME,
      descriptorVersion: USER_TASK_CREATE_TOOL_VERSION,
      timeoutMs: CONFIRMATION_TIMEOUT_MS,
    },
    {
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
      ...resolveInternalToolPolicy({
        toolName: USER_TASK_CREATE_TOOL_NAME,
        title,
        preparedAt,
      }),
      recoveryClass: 'effect_checked',
      idempotencyKey: `user-task:${invocation.toolCallId}`,
      requiredCapabilities: [USER_TASK_CREATE_TOOL_CAPABILITY],
    },
    preparedAt,
  );
}

function prepareAgentDelegation(
  invocation: ToolInvocationContract,
): ToolPlanContract {
  assertToolDataClassification(invocation);
  if (Object.keys(invocation.arguments).some((key) => key !== 'goal')) {
    throw new BadRequestException('invalid_arguments');
  }
  const goal = readString(invocation.arguments.goal).trim();
  if (!goal || goal.length > 4_000) {
    throw new BadRequestException('invalid_arguments');
  }
  const preparedAt = new Date();
  return buildToolPlan(
    invocation,
    {
      toolName: AGENT_DELEGATE_TOOL_NAME,
      descriptorVersion: AGENT_DELEGATE_TOOL_VERSION,
      timeoutMs: DELEGATION_TIMEOUT_MS,
    },
    {
      normalizedArguments: { goal },
      resources: [
        {
          resourceKey: `execution-tree:${invocation.executionContext.executionId}`,
          mode: 'shared',
          kind: 'execution_tree',
        },
      ],
      effects: [],
      ...resolveInternalToolPolicy({ toolName: AGENT_DELEGATE_TOOL_NAME }),
      recoveryClass: 'idempotent',
      idempotencyKey: `delegation:${invocation.toolCallId}`,
      requiredCapabilities: [AGENT_DELEGATE_TOOL_CAPABILITY],
    },
    preparedAt,
  );
}

export const INTERNAL_TOOL_PLAN_PREPARERS: ReadonlyArray<
  readonly [string, ToolPlanPreparer]
> = [
  [DOCUMENT_SEARCH_TOOL_NAME, prepareDocumentsSearch],
  [SKILL_RESOURCE_LOAD_TOOL_NAME, prepareSkillResourceLoad],
  [USER_TASK_CREATE_TOOL_NAME, prepareUserTaskCreate],
  [AGENT_DELEGATE_TOOL_NAME, prepareAgentDelegation],
];

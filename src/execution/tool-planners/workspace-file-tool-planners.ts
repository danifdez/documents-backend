import { BadRequestException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { IndexedFileOwnerType } from '../../indexed-file/indexed-file.entity';
import { sanitizeFilename } from '../../indexed-file/path.util';
import { ExecutionEntity } from '../execution.entity';
import {
  WORKSPACE_FILE_DELETE_TOOL_CAPABILITY,
  WORKSPACE_FILE_DELETE_TOOL_NAME,
  WORKSPACE_FILE_DELETE_TOOL_VERSION,
  WORKSPACE_FILE_LIST_TOOL_CAPABILITY,
  WORKSPACE_FILE_LIST_TOOL_NAME,
  WORKSPACE_FILE_LIST_TOOL_VERSION,
  WORKSPACE_FILE_READ_TOOL_CAPABILITY,
  WORKSPACE_FILE_READ_TOOL_NAME,
  WORKSPACE_FILE_READ_TOOL_VERSION,
  WORKSPACE_FILE_SEARCH_TOOL_CAPABILITY,
  WORKSPACE_FILE_SEARCH_TOOL_NAME,
  WORKSPACE_FILE_SEARCH_TOOL_VERSION,
  WORKSPACE_FILE_WRITE_TOOL_CAPABILITY,
  WORKSPACE_FILE_WRITE_TOOL_NAME,
  WORKSPACE_FILE_WRITE_TOOL_VERSION,
} from '../execution-tool.constants';
import {
  ToolInvocationContract,
  ToolPlanContract,
} from '../execution-tool.types';
import {
  CONFIRMATION_TIMEOUT_MS,
  PLAN_TIMEOUT_MS,
  ToolPlanPreparer,
  buildToolPlan,
  chatTurnPayload,
} from './tool-plan-preparer';

function workingFolderOwner(execution: ExecutionEntity): {
  ownerType: IndexedFileOwnerType;
  ownerId: number;
  scopeKey: string;
} {
  const ownerType =
    execution.taskType === 'assistant-chat'
      ? 'assistant'
      : execution.taskType === 'agent-chat'
        ? 'agent'
        : null;
  const payload = chatTurnPayload(execution);
  const ownerId = Number(payload.ownerId);
  if (
    !ownerType ||
    !Number.isInteger(ownerId) ||
    ownerId <= 0 ||
    typeof payload.folderScope !== 'string' ||
    payload.folderScope.length === 0
  ) {
    throw new BadRequestException('working_folder_not_configured');
  }
  const scopeKey = createHash('sha256')
    .update(payload.folderScope)
    .digest('hex')
    .slice(0, 32);
  return { ownerType, ownerId, scopeKey };
}

function normalizedFilename(value: unknown): string {
  if (typeof value !== 'string' || value.length > 500) {
    throw new BadRequestException('invalid_arguments');
  }
  try {
    return sanitizeFilename(value);
  } catch {
    throw new BadRequestException('invalid_arguments');
  }
}

function prepareWorkspaceFileRead(
  invocation: ToolInvocationContract,
  execution: ExecutionEntity,
): ToolPlanContract {
  const owner = workingFolderOwner(execution);
  const keys = Object.keys(invocation.arguments);
  if (keys.some((key) => !['filename', 'offset', 'maxChars'].includes(key))) {
    throw new BadRequestException('invalid_arguments');
  }
  const filename = normalizedFilename(invocation.arguments.filename);
  const requestedOffset = invocation.arguments.offset ?? 0;
  const requestedMaxChars = invocation.arguments.maxChars ?? 8_000;
  if (
    !Number.isInteger(requestedOffset) ||
    Number(requestedOffset) < 0 ||
    !Number.isInteger(requestedMaxChars) ||
    Number(requestedMaxChars) < 1 ||
    Number(requestedMaxChars) > 8_000
  ) {
    throw new BadRequestException('invalid_arguments');
  }
  return buildToolPlan(
    invocation,
    {
      toolName: WORKSPACE_FILE_READ_TOOL_NAME,
      descriptorVersion: WORKSPACE_FILE_READ_TOOL_VERSION,
      timeoutMs: PLAN_TIMEOUT_MS,
    },
    {
      normalizedArguments: {
        ...owner,
        filename,
        offset: Number(requestedOffset),
        maxChars: Number(requestedMaxChars),
      },
      resources: [
        {
          resourceKey: `working-folder:${owner.scopeKey}:${filename}`,
          mode: 'shared',
          kind: 'managed_file',
        },
      ],
      effects: [],
      policyDecision: { decision: 'allowed', rule: 'working_folder_read' },
      confirmationRequirement: null,
      recoveryClass: 'read_only_replayable',
      idempotencyKey: null,
      requiredCapabilities: [WORKSPACE_FILE_READ_TOOL_CAPABILITY],
    },
  );
}

function prepareWorkspaceFileList(
  invocation: ToolInvocationContract,
  execution: ExecutionEntity,
): ToolPlanContract {
  const owner = workingFolderOwner(execution);
  const keys = Object.keys(invocation.arguments);
  if (keys.some((key) => !['offset', 'limit'].includes(key))) {
    throw new BadRequestException('invalid_arguments');
  }
  const offset = invocation.arguments.offset ?? 0;
  const limit = invocation.arguments.limit ?? 100;
  if (
    !Number.isInteger(offset) ||
    Number(offset) < 0 ||
    !Number.isInteger(limit) ||
    Number(limit) < 1 ||
    Number(limit) > 200
  ) {
    throw new BadRequestException('invalid_arguments');
  }
  return buildToolPlan(
    invocation,
    {
      toolName: WORKSPACE_FILE_LIST_TOOL_NAME,
      descriptorVersion: WORKSPACE_FILE_LIST_TOOL_VERSION,
      timeoutMs: PLAN_TIMEOUT_MS,
    },
    {
      normalizedArguments: {
        ...owner,
        offset: Number(offset),
        limit: Number(limit),
      },
      resources: [
        {
          resourceKey: `working-folder:${owner.scopeKey}`,
          mode: 'shared',
          kind: 'managed_file_collection',
        },
      ],
      effects: [],
      policyDecision: { decision: 'allowed', rule: 'working_folder_list' },
      confirmationRequirement: null,
      recoveryClass: 'read_only_replayable',
      idempotencyKey: null,
      requiredCapabilities: [WORKSPACE_FILE_LIST_TOOL_CAPABILITY],
    },
  );
}

function prepareWorkspaceFileSearch(
  invocation: ToolInvocationContract,
  execution: ExecutionEntity,
): ToolPlanContract {
  const owner = workingFolderOwner(execution);
  const keys = Object.keys(invocation.arguments);
  if (keys.some((key) => !['query', 'limit'].includes(key))) {
    throw new BadRequestException('invalid_arguments');
  }
  const query = String(invocation.arguments.query ?? '').trim();
  const requestedLimit = invocation.arguments.limit ?? 10;
  if (
    query.length < 3 ||
    query.length > 2_000 ||
    !Number.isInteger(requestedLimit) ||
    Number(requestedLimit) < 1 ||
    Number(requestedLimit) > 25
  ) {
    throw new BadRequestException('invalid_arguments');
  }
  return buildToolPlan(
    invocation,
    {
      toolName: WORKSPACE_FILE_SEARCH_TOOL_NAME,
      descriptorVersion: WORKSPACE_FILE_SEARCH_TOOL_VERSION,
      timeoutMs: PLAN_TIMEOUT_MS,
    },
    {
      normalizedArguments: { ...owner, query, limit: Number(requestedLimit) },
      resources: [
        {
          resourceKey: `working-folder:${owner.scopeKey}`,
          mode: 'shared',
          kind: 'managed_file_collection',
        },
      ],
      effects: [],
      policyDecision: { decision: 'allowed', rule: 'working_folder_search' },
      confirmationRequirement: null,
      recoveryClass: 'read_only_replayable',
      idempotencyKey: null,
      requiredCapabilities: [WORKSPACE_FILE_SEARCH_TOOL_CAPABILITY],
    },
  );
}

function prepareWorkspaceFileWrite(
  invocation: ToolInvocationContract,
  execution: ExecutionEntity,
): ToolPlanContract {
  const owner = workingFolderOwner(execution);
  const keys = Object.keys(invocation.arguments);
  if (
    keys.some(
      (key) =>
        !['filename', 'content', 'contentBase64', 'overwrite'].includes(key),
    )
  ) {
    throw new BadRequestException('invalid_arguments');
  }
  const filename = normalizedFilename(invocation.arguments.filename);
  const content = invocation.arguments.content;
  const contentBase64 = invocation.arguments.contentBase64;
  if (
    (typeof content !== 'string' && typeof contentBase64 !== 'string') ||
    (typeof content === 'string' && typeof contentBase64 === 'string')
  ) {
    throw new BadRequestException('invalid_arguments');
  }
  const contentBytes =
    typeof content === 'string'
      ? Buffer.byteLength(content, 'utf8')
      : Buffer.from(contentBase64 as string, 'base64').length;
  if (
    contentBytes > 1_000_000 ||
    (typeof contentBase64 === 'string' &&
      Buffer.from(contentBase64, 'base64').toString('base64') !==
        contentBase64.replace(/\s/g, ''))
  ) {
    throw new BadRequestException('invalid_arguments');
  }
  const overwrite = invocation.arguments.overwrite ?? false;
  if (typeof overwrite !== 'boolean') {
    throw new BadRequestException('invalid_arguments');
  }
  const preparedAt = new Date();
  const expiresAt = new Date(preparedAt.getTime() + CONFIRMATION_TIMEOUT_MS);
  const resourceKey = `working-folder:${owner.scopeKey}:${filename}`;
  return buildToolPlan(
    invocation,
    {
      toolName: WORKSPACE_FILE_WRITE_TOOL_NAME,
      descriptorVersion: WORKSPACE_FILE_WRITE_TOOL_VERSION,
      timeoutMs: CONFIRMATION_TIMEOUT_MS,
    },
    {
      normalizedArguments: {
        ...owner,
        filename,
        ...(typeof content === 'string' ? { content } : { contentBase64 }),
        overwrite,
      },
      resources: [{ resourceKey, mode: 'exclusive', kind: 'managed_file' }],
      effects: [
        {
          effectClass: overwrite ? 'local_destructive' : 'local_reversible',
          resourceKey,
          description: `${overwrite ? 'Replace' : 'Create'} file: ${filename}`,
          reversible: !overwrite,
          verificationRequired: true,
        },
      ],
      policyDecision: {
        decision: 'confirmation_required',
        rule: 'working_folder_write_requires_confirmation',
        expiresAt: expiresAt.toISOString(),
      },
      confirmationRequirement: {
        confirmationId: randomUUID(),
        reason: 'Writing a file changes data in the selected working folder.',
        prompt: `${overwrite ? 'Replace' : 'Create'} "${filename}"?`,
        scope: 'once',
        expiresAt: expiresAt.toISOString(),
      },
      recoveryClass: 'effect_checked',
      idempotencyKey: `working-file:${owner.scopeKey}:${invocation.toolCallId}`,
      requiredCapabilities: [WORKSPACE_FILE_WRITE_TOOL_CAPABILITY],
    },
    preparedAt,
  );
}

function prepareWorkspaceFileDelete(
  invocation: ToolInvocationContract,
  execution: ExecutionEntity,
): ToolPlanContract {
  const owner = workingFolderOwner(execution);
  if (Object.keys(invocation.arguments).some((key) => key !== 'filename')) {
    throw new BadRequestException('invalid_arguments');
  }
  const filename = normalizedFilename(invocation.arguments.filename);
  const preparedAt = new Date();
  const expiresAt = new Date(preparedAt.getTime() + CONFIRMATION_TIMEOUT_MS);
  const resourceKey = `working-folder:${owner.scopeKey}:${filename}`;
  const idempotencyKey = `working-file-delete:${owner.scopeKey}:${invocation.toolCallId}`;
  return buildToolPlan(
    invocation,
    {
      toolName: WORKSPACE_FILE_DELETE_TOOL_NAME,
      descriptorVersion: WORKSPACE_FILE_DELETE_TOOL_VERSION,
      timeoutMs: CONFIRMATION_TIMEOUT_MS,
    },
    {
      normalizedArguments: { ...owner, filename },
      resources: [{ resourceKey, mode: 'exclusive', kind: 'managed_file' }],
      effects: [
        {
          effectClass: 'local_destructive',
          resourceKey,
          description: `Delete file: ${filename}`,
          reversible: false,
          verificationRequired: true,
        },
      ],
      policyDecision: {
        decision: 'confirmation_required',
        rule: 'working_folder_delete_requires_confirmation',
        expiresAt: expiresAt.toISOString(),
      },
      confirmationRequirement: {
        confirmationId: randomUUID(),
        reason:
          'Deleting a file removes data from the selected working folder.',
        prompt: `Delete "${filename}"?`,
        scope: 'once',
        expiresAt: expiresAt.toISOString(),
      },
      recoveryClass: 'effect_checked',
      idempotencyKey,
      requiredCapabilities: [WORKSPACE_FILE_DELETE_TOOL_CAPABILITY],
    },
    preparedAt,
  );
}

export const WORKSPACE_FILE_TOOL_PLAN_PREPARERS: ReadonlyArray<
  readonly [string, ToolPlanPreparer]
> = [
  [WORKSPACE_FILE_READ_TOOL_NAME, prepareWorkspaceFileRead],
  [WORKSPACE_FILE_LIST_TOOL_NAME, prepareWorkspaceFileList],
  [WORKSPACE_FILE_SEARCH_TOOL_NAME, prepareWorkspaceFileSearch],
  [WORKSPACE_FILE_WRITE_TOOL_NAME, prepareWorkspaceFileWrite],
  [WORKSPACE_FILE_DELETE_TOOL_NAME, prepareWorkspaceFileDelete],
];

import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  BROWSER_CLICK_TOOL_CAPABILITY,
  BROWSER_CLICK_TOOL_NAME,
  BROWSER_CLICK_TOOL_VERSION,
  BROWSER_GO_BACK_TOOL_CAPABILITY,
  BROWSER_GO_BACK_TOOL_NAME,
  BROWSER_GO_BACK_TOOL_VERSION,
  BROWSER_NAVIGATE_TOOL_CAPABILITY,
  BROWSER_NAVIGATE_TOOL_NAME,
  BROWSER_NAVIGATE_TOOL_VERSION,
  BROWSER_READ_TOOL_CAPABILITY,
  BROWSER_READ_TOOL_NAME,
  BROWSER_READ_TOOL_VERSION,
  BROWSER_RUN_TASK_TOOL_CAPABILITY,
  BROWSER_RUN_TASK_TOOL_NAME,
  BROWSER_RUN_TASK_TOOL_VERSION,
  BROWSER_SELECT_OPTION_TOOL_CAPABILITY,
  BROWSER_SELECT_OPTION_TOOL_NAME,
  BROWSER_SELECT_OPTION_TOOL_VERSION,
  BROWSER_TYPE_TEXT_TOOL_CAPABILITY,
  BROWSER_TYPE_TEXT_TOOL_NAME,
  BROWSER_TYPE_TEXT_TOOL_VERSION,
} from '../execution-tool.constants';
import {
  ToolInvocationContract,
  ToolPlanContract,
} from '../execution-tool.types';
import {
  BROWSER_READ_TIMEOUT_MS,
  BROWSER_TASK_TIMEOUT_MS,
  CONFIRMATION_TIMEOUT_MS,
  ToolPlanPreparer,
} from './tool-plan-preparer';

function isHttpUrl(value: string): boolean {
  if (value.length > 2_048) return false;
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function prepareBrowserTask(
  invocation: ToolInvocationContract,
): ToolPlanContract {
  if (invocation.executionContext.dataClassification === 'secret') {
    throw new BadRequestException('data_policy_violation');
  }
  if (
    Object.keys(invocation.arguments).some((key) => key !== 'goal') ||
    typeof invocation.arguments.goal !== 'string'
  ) {
    throw new BadRequestException('invalid_arguments');
  }
  const goal = invocation.arguments.goal.trim();
  if (!goal || goal.length > 4_000) {
    throw new BadRequestException('invalid_arguments');
  }
  const preparedAt = new Date();
  const expiresAt = new Date(preparedAt.getTime() + CONFIRMATION_TIMEOUT_MS);
  return {
    schemaVersion: 'tool-plan/1',
    operationId: randomUUID(),
    toolCallId: invocation.toolCallId,
    toolName: BROWSER_RUN_TASK_TOOL_NAME,
    descriptorVersion: BROWSER_RUN_TASK_TOOL_VERSION,
    normalizedArguments: { goal },
    resources: [
      {
        resourceKey: 'browser:active-page',
        mode: 'exclusive',
        kind: 'browser_page',
      },
    ],
    effects: [
      {
        effectClass: 'external_irreversible',
        resourceKey: 'browser:active-page',
        description: `Run browser task: ${goal.slice(0, 200)}`,
        reversible: false,
        verificationRequired: true,
      },
    ],
    policyDecision: {
      decision: 'confirmation_required',
      rule: 'paired_browser_task_requires_confirmation',
      expiresAt: expiresAt.toISOString(),
    },
    confirmationRequirement: {
      confirmationId: randomUUID(),
      reason: 'The browser agent can visit websites and interact with them.',
      prompt: `Run this task in a separate IA Browser tab? ${goal.slice(0, 200)}`,
      scope: 'once',
      expiresAt: expiresAt.toISOString(),
    },
    recoveryClass: 'non_resumable',
    idempotencyKey: `browser-task:${invocation.toolCallId}`,
    requiredCapabilities: [BROWSER_RUN_TASK_TOOL_CAPABILITY],
    deadline: new Date(
      preparedAt.getTime() + BROWSER_TASK_TIMEOUT_MS,
    ).toISOString(),
    preparedAt: preparedAt.toISOString(),
  };
}

function prepareBrowserRead(
  invocation: ToolInvocationContract,
): ToolPlanContract {
  if (invocation.executionContext.dataClassification === 'secret') {
    throw new BadRequestException('data_policy_violation');
  }
  const keys = Object.keys(invocation.arguments);
  if (keys.some((key) => !['expectedUrl', 'maxChars'].includes(key))) {
    throw new BadRequestException('invalid_arguments');
  }
  const rawExpectedUrl = invocation.arguments.expectedUrl;
  if (
    rawExpectedUrl !== undefined &&
    rawExpectedUrl !== null &&
    typeof rawExpectedUrl !== 'string'
  ) {
    throw new BadRequestException('invalid_arguments');
  }
  const expectedUrl =
    typeof rawExpectedUrl === 'string' ? rawExpectedUrl.trim() || null : null;
  if (expectedUrl && !isHttpUrl(expectedUrl)) {
    throw new BadRequestException('invalid_arguments');
  }
  const requestedMaxChars = invocation.arguments.maxChars ?? 20_000;
  if (
    !Number.isInteger(requestedMaxChars) ||
    Number(requestedMaxChars) < 1 ||
    Number(requestedMaxChars) > 50_000
  ) {
    throw new BadRequestException('invalid_arguments');
  }
  const preparedAt = new Date();
  return {
    schemaVersion: 'tool-plan/1',
    operationId: randomUUID(),
    toolCallId: invocation.toolCallId,
    toolName: BROWSER_READ_TOOL_NAME,
    descriptorVersion: BROWSER_READ_TOOL_VERSION,
    normalizedArguments: {
      expectedUrl,
      maxChars: Number(requestedMaxChars),
    },
    resources: [
      {
        resourceKey: 'browser:active-page',
        mode: 'shared',
        kind: 'browser_page',
      },
    ],
    effects: [],
    policyDecision: { decision: 'allowed', rule: 'paired_browser_read' },
    confirmationRequirement: null,
    recoveryClass: 'read_only_replayable',
    idempotencyKey: null,
    requiredCapabilities: [BROWSER_READ_TOOL_CAPABILITY],
    deadline: new Date(
      preparedAt.getTime() + BROWSER_READ_TIMEOUT_MS,
    ).toISOString(),
    preparedAt: preparedAt.toISOString(),
  };
}

function prepareBrowserNavigate(
  invocation: ToolInvocationContract,
): ToolPlanContract {
  if (invocation.executionContext.dataClassification === 'secret') {
    throw new BadRequestException('data_policy_violation');
  }
  const keys = Object.keys(invocation.arguments);
  if (keys.some((key) => !['url', 'expectedCurrentUrl'].includes(key))) {
    throw new BadRequestException('invalid_arguments');
  }
  const url =
    typeof invocation.arguments.url === 'string'
      ? invocation.arguments.url.trim()
      : '';
  const rawExpectedCurrentUrl = invocation.arguments.expectedCurrentUrl;
  if (
    !isHttpUrl(url) ||
    (rawExpectedCurrentUrl !== undefined &&
      (typeof rawExpectedCurrentUrl !== 'string' ||
        !isHttpUrl(rawExpectedCurrentUrl.trim())))
  ) {
    throw new BadRequestException('invalid_arguments');
  }
  const expectedCurrentUrl =
    typeof rawExpectedCurrentUrl === 'string'
      ? rawExpectedCurrentUrl.trim()
      : null;
  const preparedAt = new Date();
  const expiresAt = new Date(preparedAt.getTime() + CONFIRMATION_TIMEOUT_MS);
  const resourceKey = 'browser:active-page';
  return {
    schemaVersion: 'tool-plan/1',
    operationId: randomUUID(),
    toolCallId: invocation.toolCallId,
    toolName: BROWSER_NAVIGATE_TOOL_NAME,
    descriptorVersion: BROWSER_NAVIGATE_TOOL_VERSION,
    normalizedArguments: { url, expectedCurrentUrl },
    resources: [{ resourceKey, mode: 'exclusive', kind: 'browser_page' }],
    effects: [
      {
        effectClass: 'external_reversible',
        resourceKey,
        description: `Navigate IA Browser to: ${url}`,
        reversible: true,
        verificationRequired: true,
      },
    ],
    policyDecision: {
      decision: 'confirmation_required',
      rule: 'paired_browser_navigation_requires_confirmation',
      expiresAt: expiresAt.toISOString(),
    },
    confirmationRequirement: {
      confirmationId: randomUUID(),
      reason: 'Navigation changes the active page in the paired IA Browser.',
      prompt: `Navigate IA Browser to "${url}"?`,
      scope: 'once',
      expiresAt: expiresAt.toISOString(),
    },
    recoveryClass: 'effect_checked',
    idempotencyKey: `browser-navigate:${invocation.toolCallId}`,
    requiredCapabilities: [BROWSER_NAVIGATE_TOOL_CAPABILITY],
    deadline: expiresAt.toISOString(),
    preparedAt: preparedAt.toISOString(),
  };
}

function prepareBrowserGoBack(
  invocation: ToolInvocationContract,
): ToolPlanContract {
  if (invocation.executionContext.dataClassification === 'secret') {
    throw new BadRequestException('data_policy_violation');
  }
  if (
    Object.keys(invocation.arguments).some(
      (key) => key !== 'expectedCurrentUrl',
    ) ||
    typeof invocation.arguments.expectedCurrentUrl !== 'string'
  ) {
    throw new BadRequestException('invalid_arguments');
  }
  const expectedCurrentUrl = invocation.arguments.expectedCurrentUrl.trim();
  if (!isHttpUrl(expectedCurrentUrl)) {
    throw new BadRequestException('invalid_arguments');
  }
  const preparedAt = new Date();
  const expiresAt = new Date(preparedAt.getTime() + CONFIRMATION_TIMEOUT_MS);
  const resourceKey = 'browser:active-page';
  return {
    schemaVersion: 'tool-plan/1',
    operationId: randomUUID(),
    toolCallId: invocation.toolCallId,
    toolName: BROWSER_GO_BACK_TOOL_NAME,
    descriptorVersion: BROWSER_GO_BACK_TOOL_VERSION,
    normalizedArguments: { expectedCurrentUrl },
    resources: [{ resourceKey, mode: 'exclusive', kind: 'browser_page' }],
    effects: [
      {
        effectClass: 'external_reversible',
        resourceKey,
        description: `Go back from: ${expectedCurrentUrl}`,
        reversible: true,
        verificationRequired: true,
      },
    ],
    policyDecision: {
      decision: 'confirmation_required',
      rule: 'paired_browser_history_navigation_requires_confirmation',
      expiresAt: expiresAt.toISOString(),
    },
    confirmationRequirement: {
      confirmationId: randomUUID(),
      reason: 'Going back changes the active page in the paired IA Browser.',
      prompt: `Go back from "${expectedCurrentUrl}" in IA Browser?`,
      scope: 'once',
      expiresAt: expiresAt.toISOString(),
    },
    recoveryClass: 'effect_checked',
    idempotencyKey: `browser-go-back:${invocation.toolCallId}`,
    requiredCapabilities: [BROWSER_GO_BACK_TOOL_CAPABILITY],
    deadline: expiresAt.toISOString(),
    preparedAt: preparedAt.toISOString(),
  };
}

function prepareBrowserClick(
  invocation: ToolInvocationContract,
): ToolPlanContract {
  if (invocation.executionContext.dataClassification === 'secret') {
    throw new BadRequestException('data_policy_violation');
  }
  const allowedKeys = [
    'expectedCurrentUrl',
    'elementIndex',
    'expectedKind',
    'expectedLabel',
  ];
  if (
    Object.keys(invocation.arguments).some(
      (key) => !allowedKeys.includes(key),
    ) ||
    typeof invocation.arguments.expectedCurrentUrl !== 'string' ||
    !Number.isInteger(invocation.arguments.elementIndex) ||
    typeof invocation.arguments.expectedKind !== 'string' ||
    typeof invocation.arguments.expectedLabel !== 'string'
  ) {
    throw new BadRequestException('invalid_arguments');
  }
  const expectedCurrentUrl = invocation.arguments.expectedCurrentUrl.trim();
  const elementIndex = Number(invocation.arguments.elementIndex);
  const expectedKind = invocation.arguments.expectedKind.trim();
  const expectedLabel = invocation.arguments.expectedLabel.trim();
  if (
    !isHttpUrl(expectedCurrentUrl) ||
    elementIndex < 1 ||
    elementIndex > 60 ||
    !['link', 'button'].includes(expectedKind) ||
    !expectedLabel ||
    expectedLabel.length > 120
  ) {
    throw new BadRequestException('invalid_arguments');
  }
  const preparedAt = new Date();
  const expiresAt = new Date(preparedAt.getTime() + CONFIRMATION_TIMEOUT_MS);
  const resourceKey = 'browser:active-page';
  const labelForPrompt = JSON.stringify(expectedLabel);
  const urlForPrompt = JSON.stringify(expectedCurrentUrl);
  return {
    schemaVersion: 'tool-plan/1',
    operationId: randomUUID(),
    toolCallId: invocation.toolCallId,
    toolName: BROWSER_CLICK_TOOL_NAME,
    descriptorVersion: BROWSER_CLICK_TOOL_VERSION,
    normalizedArguments: {
      expectedCurrentUrl,
      elementIndex,
      expectedKind,
      expectedLabel,
    },
    resources: [{ resourceKey, mode: 'exclusive', kind: 'browser_page' }],
    effects: [
      {
        effectClass: 'external_irreversible',
        resourceKey,
        description:
          `Click ${expectedKind} "${expectedLabel}" ` +
          `(control ${elementIndex}) on ${expectedCurrentUrl}`,
        reversible: false,
        verificationRequired: true,
      },
    ],
    policyDecision: {
      decision: 'confirmation_required',
      rule: 'paired_browser_click_requires_confirmation',
      expiresAt: expiresAt.toISOString(),
    },
    confirmationRequirement: {
      confirmationId: randomUUID(),
      reason: 'Clicking a page control can trigger an external action.',
      prompt:
        `Click ${expectedKind} ${labelForPrompt} ` +
        `(control ${elementIndex}) on ${urlForPrompt}?`,
      scope: 'once',
      expiresAt: expiresAt.toISOString(),
    },
    recoveryClass: 'effect_checked',
    idempotencyKey: `browser-click:${invocation.toolCallId}`,
    requiredCapabilities: [BROWSER_CLICK_TOOL_CAPABILITY],
    deadline: expiresAt.toISOString(),
    preparedAt: preparedAt.toISOString(),
  };
}

function prepareBrowserTypeText(
  invocation: ToolInvocationContract,
): ToolPlanContract {
  if (invocation.executionContext.dataClassification === 'secret') {
    throw new BadRequestException('data_policy_violation');
  }
  const allowedKeys = [
    'expectedCurrentUrl',
    'elementIndex',
    'expectedLabel',
    'expectedCurrentValue',
    'expectedCurrentValueTruncated',
    'text',
  ];
  const expectedCurrentValue = invocation.arguments.expectedCurrentValue;
  const text = invocation.arguments.text;
  if (
    Object.keys(invocation.arguments).some(
      (key) => !allowedKeys.includes(key),
    ) ||
    typeof invocation.arguments.expectedCurrentUrl !== 'string' ||
    !Number.isInteger(invocation.arguments.elementIndex) ||
    typeof invocation.arguments.expectedLabel !== 'string' ||
    typeof expectedCurrentValue !== 'string' ||
    invocation.arguments.expectedCurrentValueTruncated !== false ||
    typeof text !== 'string'
  ) {
    throw new BadRequestException('invalid_arguments');
  }
  const expectedCurrentUrl = invocation.arguments.expectedCurrentUrl.trim();
  const elementIndex = Number(invocation.arguments.elementIndex);
  const expectedLabel = invocation.arguments.expectedLabel.trim();
  const normalizedCurrentValue = expectedCurrentValue
    .replace(/\s+/g, ' ')
    .trim();
  const normalizedText = text.replace(/\s+/g, ' ').trim();
  if (
    !isHttpUrl(expectedCurrentUrl) ||
    elementIndex < 1 ||
    elementIndex > 60 ||
    !expectedLabel ||
    expectedLabel.length > 120 ||
    expectedCurrentValue !== normalizedCurrentValue ||
    expectedCurrentValue.length > 60 ||
    text !== normalizedText ||
    !text ||
    text.length > 60
  ) {
    throw new BadRequestException('invalid_arguments');
  }
  const preparedAt = new Date();
  const expiresAt = new Date(preparedAt.getTime() + CONFIRMATION_TIMEOUT_MS);
  const resourceKey = 'browser:active-page';
  const labelForPrompt = JSON.stringify(expectedLabel);
  const textForPrompt = JSON.stringify(text);
  const urlForPrompt = JSON.stringify(expectedCurrentUrl);
  return {
    schemaVersion: 'tool-plan/1',
    operationId: randomUUID(),
    toolCallId: invocation.toolCallId,
    toolName: BROWSER_TYPE_TEXT_TOOL_NAME,
    descriptorVersion: BROWSER_TYPE_TEXT_TOOL_VERSION,
    normalizedArguments: {
      expectedCurrentUrl,
      elementIndex,
      expectedLabel,
      expectedCurrentValue,
      expectedCurrentValueTruncated: false,
      text,
    },
    resources: [{ resourceKey, mode: 'exclusive', kind: 'browser_page' }],
    effects: [
      {
        effectClass: 'external_irreversible',
        resourceKey,
        description:
          `Type text into field "${expectedLabel}" ` +
          `(control ${elementIndex}) on ${expectedCurrentUrl}`,
        reversible: false,
        verificationRequired: true,
      },
    ],
    policyDecision: {
      decision: 'confirmation_required',
      rule: 'paired_browser_type_text_requires_confirmation',
      expiresAt: expiresAt.toISOString(),
    },
    confirmationRequirement: {
      confirmationId: randomUUID(),
      reason: 'Typing can trigger input handlers on an external page.',
      prompt:
        `Type ${textForPrompt} into field ${labelForPrompt} ` +
        `(control ${elementIndex}) on ${urlForPrompt} without submitting?`,
      scope: 'once',
      expiresAt: expiresAt.toISOString(),
    },
    recoveryClass: 'effect_checked',
    idempotencyKey: `browser-type-text:${invocation.toolCallId}`,
    requiredCapabilities: [BROWSER_TYPE_TEXT_TOOL_CAPABILITY],
    deadline: expiresAt.toISOString(),
    preparedAt: preparedAt.toISOString(),
  };
}

function prepareBrowserSelectOption(
  invocation: ToolInvocationContract,
): ToolPlanContract {
  if (invocation.executionContext.dataClassification === 'secret') {
    throw new BadRequestException('data_policy_violation');
  }
  const allowedKeys = [
    'expectedCurrentUrl',
    'elementIndex',
    'expectedLabel',
    'expectedCurrentValue',
    'expectedCurrentValueTruncated',
    'optionValue',
    'expectedOptionLabel',
  ];
  const expectedCurrentValue = invocation.arguments.expectedCurrentValue;
  const optionValue = invocation.arguments.optionValue;
  const expectedOptionLabel = invocation.arguments.expectedOptionLabel;
  if (
    Object.keys(invocation.arguments).some(
      (key) => !allowedKeys.includes(key),
    ) ||
    typeof invocation.arguments.expectedCurrentUrl !== 'string' ||
    !Number.isInteger(invocation.arguments.elementIndex) ||
    typeof invocation.arguments.expectedLabel !== 'string' ||
    typeof expectedCurrentValue !== 'string' ||
    invocation.arguments.expectedCurrentValueTruncated !== false ||
    typeof optionValue !== 'string' ||
    typeof expectedOptionLabel !== 'string'
  ) {
    throw new BadRequestException('invalid_arguments');
  }
  const expectedCurrentUrl = invocation.arguments.expectedCurrentUrl.trim();
  const elementIndex = Number(invocation.arguments.elementIndex);
  const expectedLabel = invocation.arguments.expectedLabel.trim();
  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
  if (
    !isHttpUrl(expectedCurrentUrl) ||
    elementIndex < 1 ||
    elementIndex > 60 ||
    !expectedLabel ||
    expectedLabel.length > 120 ||
    expectedCurrentValue !== normalize(expectedCurrentValue) ||
    expectedCurrentValue.length > 60 ||
    optionValue !== normalize(optionValue) ||
    !optionValue ||
    optionValue.length > 120 ||
    expectedOptionLabel !== normalize(expectedOptionLabel) ||
    !expectedOptionLabel ||
    expectedOptionLabel.length > 120
  ) {
    throw new BadRequestException('invalid_arguments');
  }
  const preparedAt = new Date();
  const expiresAt = new Date(preparedAt.getTime() + CONFIRMATION_TIMEOUT_MS);
  const resourceKey = 'browser:active-page';
  return {
    schemaVersion: 'tool-plan/1',
    operationId: randomUUID(),
    toolCallId: invocation.toolCallId,
    toolName: BROWSER_SELECT_OPTION_TOOL_NAME,
    descriptorVersion: BROWSER_SELECT_OPTION_TOOL_VERSION,
    normalizedArguments: {
      expectedCurrentUrl,
      elementIndex,
      expectedLabel,
      expectedCurrentValue,
      expectedCurrentValueTruncated: false,
      optionValue,
      expectedOptionLabel,
    },
    resources: [{ resourceKey, mode: 'exclusive', kind: 'browser_page' }],
    effects: [
      {
        effectClass: 'external_irreversible',
        resourceKey,
        description:
          `Select option "${expectedOptionLabel}" in field ` +
          `"${expectedLabel}" (control ${elementIndex}) on ${expectedCurrentUrl}`,
        reversible: false,
        verificationRequired: true,
      },
    ],
    policyDecision: {
      decision: 'confirmation_required',
      rule: 'paired_browser_select_option_requires_confirmation',
      expiresAt: expiresAt.toISOString(),
    },
    confirmationRequirement: {
      confirmationId: randomUUID(),
      reason: 'Selecting an option can trigger handlers on an external page.',
      prompt:
        `Select ${JSON.stringify(expectedOptionLabel)} in field ` +
        `${JSON.stringify(expectedLabel)} (control ${elementIndex}) on ` +
        `${JSON.stringify(expectedCurrentUrl)} without submitting?`,
      scope: 'once',
      expiresAt: expiresAt.toISOString(),
    },
    recoveryClass: 'effect_checked',
    idempotencyKey: `browser-select-option:${invocation.toolCallId}`,
    requiredCapabilities: [BROWSER_SELECT_OPTION_TOOL_CAPABILITY],
    deadline: expiresAt.toISOString(),
    preparedAt: preparedAt.toISOString(),
  };
}

export const BROWSER_TOOL_PLAN_PREPARERS: ReadonlyArray<
  readonly [string, ToolPlanPreparer]
> = [
  [BROWSER_RUN_TASK_TOOL_NAME, prepareBrowserTask],
  [BROWSER_READ_TOOL_NAME, prepareBrowserRead],
  [BROWSER_NAVIGATE_TOOL_NAME, prepareBrowserNavigate],
  [BROWSER_GO_BACK_TOOL_NAME, prepareBrowserGoBack],
  [BROWSER_CLICK_TOOL_NAME, prepareBrowserClick],
  [BROWSER_TYPE_TEXT_TOOL_NAME, prepareBrowserTypeText],
  [BROWSER_SELECT_OPTION_TOOL_NAME, prepareBrowserSelectOption],
];

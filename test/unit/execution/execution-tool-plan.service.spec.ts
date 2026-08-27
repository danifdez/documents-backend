import { canonicalHash } from '../../../src/execution/execution-canonical';
import { ExecutionEntity } from '../../../src/execution/execution.entity';
import { ExecutionEventEntity } from '../../../src/execution/execution-event.entity';
import { ExecutionOperationEntity } from '../../../src/execution/execution-operation.entity';
import { ExecutionOperationRecoveryClass } from '../../../src/execution/execution-operation-recovery-class.enum';
import { ExecutionOperationStatus } from '../../../src/execution/execution-operation-status.enum';
import { ExecutionStatus } from '../../../src/execution/execution-status.enum';
import { ExecutionStepAttemptEntity } from '../../../src/execution/execution-step-attempt.entity';
import { ExecutionStepAttemptStatus } from '../../../src/execution/execution-step-attempt-status.enum';
import { ExecutionStepDependencyEntity } from '../../../src/execution/execution-step-dependency.entity';
import { ExecutionStepEntity } from '../../../src/execution/execution-step.entity';
import { ExecutionStepKind } from '../../../src/execution/execution-step-kind.enum';
import { ExecutionStepStatus } from '../../../src/execution/execution-step-status.enum';
import { ExecutionToolInvocationEntity } from '../../../src/execution/execution-tool-invocation.entity';
import { ExecutionToolPlanEntity } from '../../../src/execution/execution-tool-plan.entity';
import { ExecutionToolPlanService } from '../../../src/execution/execution-tool-plan.service';
import {
  ToolInvocationContract,
  ToolPlanContract,
} from '../../../src/execution/execution-tool.types';

const EXECUTION_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca701';
const SOURCE_STEP_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca702';
const SOURCE_OPERATION_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca703';
const SOURCE_ATTEMPT_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca704';
const TOOL_CALL_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca705';
const TOOL_OPERATION_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca706';
const EVENT_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca707';
const RESERVATION_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca708';

describe('ExecutionToolPlanService', () => {
  let service: ExecutionToolPlanService;
  let execution: Record<string, any>;
  let executionRepo: Record<string, jest.Mock>;
  let eventRepo: Record<string, jest.Mock>;
  let attemptRepo: Record<string, jest.Mock>;
  let stepRepo: Record<string, jest.Mock>;
  let operationRepo: Record<string, jest.Mock>;
  let dependencyRepo: Record<string, jest.Mock>;
  let invocationRepo: Record<string, jest.Mock>;
  let planRepo: Record<string, jest.Mock>;
  let manager: Record<string, jest.Mock>;
  let confirmations: Record<string, jest.Mock>;
  let executions: Record<string, jest.Mock>;

  const invocation = (
    overrides: Partial<ToolInvocationContract> = {},
  ): ToolInvocationContract => ({
    schemaVersion: 'tool-invocation/1',
    toolCallId: TOOL_CALL_ID,
    name: 'documents.search',
    arguments: { query: '  harness  ' },
    requester: {
      kind: 'model',
      operationId: SOURCE_OPERATION_ID,
      attemptId: SOURCE_ATTEMPT_ID,
    },
    executionContext: {
      executionId: EXECUTION_ID,
      causedByEventId: EVENT_ID,
      phase: 'tool',
      dataClassification: 'workspace',
    },
    ...overrides,
  });

  const planContract = (): ToolPlanContract => ({
    schemaVersion: 'tool-plan/1',
    operationId: TOOL_OPERATION_ID,
    toolCallId: TOOL_CALL_ID,
    toolName: 'documents.search',
    descriptorVersion: 'documents.search/1',
    normalizedArguments: { query: 'harness', limit: 10 },
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
    requiredCapabilities: ['tool.documents.search/1'],
    deadline: new Date(Date.now() + 60_000).toISOString(),
    preparedAt: new Date().toISOString(),
  });

  beforeEach(() => {
    execution = {
      executionId: EXECUTION_ID,
      rootExecutionId: EXECUTION_ID,
      status: ExecutionStatus.RUNNING,
      phase: 'backend_finalization',
      lastEventId: EVENT_ID,
      progressLedger: null,
      payload: {
        activeCapabilities: {
          tools: [
            'documents.search',
            'skills.load_resource',
            'user_tasks.create',
            'agents.delegate',
            'browser.navigate',
            'browser.go_back',
            'browser.click',
            'browser.type_text',
            'browser.select_option',
            'browser.read_current_page',
            'workspace_files.list',
            'workspace_files.search',
            'workspace_files.read',
            'workspace_files.write',
            'workspace_files.delete',
          ].map((name) => ({ name })),
          skills: [
            {
              skillId: 'workspace-document-workflow',
              version: 'workspace-document-workflow/1',
              contentHash:
                'sha256:c755864bb8f6b113ff62c4912c20277bf66e71d37819921de46111a24c7cec91',
              resources: [
                {
                  resourceId: 'document-format-handling',
                  contentHash:
                    'sha256:ccb06824a5ed7559cac8327619cb3f8de834ee44f2fda7f0460c7501df1b179c',
                },
              ],
            },
            {
              skillId: 'evidence-research-workflow',
              version: 'evidence-research-workflow/1',
              contentHash:
                'sha256:902f4eb209b750d9b7a62c8cb9daa297158e45a284a8f857fba3a676dcea8002',
              resources: [
                {
                  resourceId: 'source-evaluation',
                  contentHash:
                    'sha256:3c5472ac70881363440979f779dac8ad657c662a6666495a5f667ef4a8a79879',
                },
              ],
            },
          ],
        },
      },
    };
    executionRepo = {
      findOne: jest.fn().mockResolvedValue(execution),
      find: jest.fn().mockResolvedValue([execution]),
      save: jest.fn(async (value) => value),
    };
    eventRepo = {
      findOneBy: jest.fn().mockResolvedValue({ eventId: EVENT_ID }),
    };
    attemptRepo = {
      findOneBy: jest.fn().mockResolvedValue({
        executionId: EXECUTION_ID,
        operationId: SOURCE_OPERATION_ID,
        status: ExecutionStepAttemptStatus.CLOSED,
      }),
    };
    stepRepo = {
      find: jest.fn().mockResolvedValue([
        {
          stepId: SOURCE_STEP_ID,
          executionId: EXECUTION_ID,
          status: ExecutionStepStatus.COMPLETED,
        },
      ]),
      findOneBy: jest.fn().mockResolvedValue({
        stepId: SOURCE_STEP_ID,
        executionId: EXECUTION_ID,
        operationId: SOURCE_OPERATION_ID,
        status: ExecutionStepStatus.COMPLETED,
      }),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    operationRepo = {
      create: jest.fn((value) => value),
      findOneByOrFail: jest.fn().mockResolvedValue({
        operationId: TOOL_OPERATION_ID,
        status: ExecutionOperationStatus.PLANNED,
      }),
      save: jest.fn(async (value) => value),
    };
    dependencyRepo = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    invocationRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      findOneBy: jest.fn(),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    planRepo = {
      findOne: jest.fn(),
      findOneBy: jest.fn(),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    manager = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn((entity) => {
        if (entity === ExecutionEntity) return executionRepo;
        if (entity === ExecutionEventEntity) return eventRepo;
        if (entity === ExecutionStepAttemptEntity) return attemptRepo;
        if (entity === ExecutionStepEntity) return stepRepo;
        if (entity === ExecutionOperationEntity) return operationRepo;
        if (entity === ExecutionStepDependencyEntity) return dependencyRepo;
        if (entity === ExecutionToolInvocationEntity) return invocationRepo;
        if (entity === ExecutionToolPlanEntity) return planRepo;
        throw new Error(`Unexpected repository ${entity.name}`);
      }),
    };
    confirmations = {
      createPending: jest.fn().mockResolvedValue(null),
      decisionForPlan: jest.fn().mockResolvedValue(null),
      activatePending: jest.fn().mockResolvedValue(0),
    };
    executions = { createChildInference: jest.fn() };
    service = new ExecutionToolPlanService(
      {
        transaction: jest.fn(async (callback) => callback(manager)),
      } as any,
      {
        assertToolInvocation: jest.fn(),
        assertToolPlan: jest.fn(),
        assertToolResult: jest.fn(),
      } as any,
      confirmations as any,
      executions as any,
    );
  });

  it('persists an allowed read-only plan without creating executable work', async () => {
    const prepared = await service.prepare(invocation());

    expect(prepared.duplicate).toBe(false);
    expect(prepared.plan.plan).toEqual(
      expect.objectContaining({
        operationId: expect.any(String),
        normalizedArguments: { query: 'harness', limit: 10 },
        policyDecision: { decision: 'allowed', rule: 'local_documents_read' },
        recoveryClass: 'read_only_replayable',
      }),
    );
    expect(prepared.plan.stepId).toBeNull();
    expect(stepRepo.save).not.toHaveBeenCalled();
    expect(operationRepo.save).not.toHaveBeenCalled();
    expect(execution.phase).toBe('tool_planning');
    expect(confirmations.createPending).toHaveBeenCalled();
  });

  it('pins a selected skill resource as a read-only plan', async () => {
    const prepared = await service.prepare(
      invocation({
        name: 'skills.load_resource',
        arguments: {
          skillId: 'workspace-document-workflow',
          skillVersion: 'workspace-document-workflow/1',
          skillContentHash:
            'sha256:c755864bb8f6b113ff62c4912c20277bf66e71d37819921de46111a24c7cec91',
          resourceId: 'document-format-handling',
          resourceContentHash:
            'sha256:ccb06824a5ed7559cac8327619cb3f8de834ee44f2fda7f0460c7501df1b179c',
        },
      }),
    );

    expect(prepared.plan.plan).toEqual(
      expect.objectContaining({
        toolName: 'skills.load_resource',
        descriptorVersion: 'skills.load_resource/1',
        policyDecision: {
          decision: 'allowed',
          rule: 'active_product_skill_resource_read',
        },
        recoveryClass: 'read_only_replayable',
        requiredCapabilities: ['tool.skills.load_resource/1'],
      }),
    );
  });

  it('rejects a resource that was not frozen in the active skill', async () => {
    await expect(
      service.prepare(
        invocation({
          name: 'skills.load_resource',
          arguments: {
            skillId: 'workspace-document-workflow',
            skillVersion: 'workspace-document-workflow/1',
            skillContentHash:
              'sha256:c755864bb8f6b113ff62c4912c20277bf66e71d37819921de46111a24c7cec91',
            resourceId: 'unknown',
            resourceContentHash: 'sha256:' + '0'.repeat(64),
          },
        }),
      ),
    ).rejects.toThrow('skill_resource_not_active');
  });

  it('prepares resources for a second independently registered skill', async () => {
    const prepared = await service.prepare(
      invocation({
        name: 'skills.load_resource',
        arguments: {
          skillId: 'evidence-research-workflow',
          skillVersion: 'evidence-research-workflow/1',
          skillContentHash:
            'sha256:902f4eb209b750d9b7a62c8cb9daa297158e45a284a8f857fba3a676dcea8002',
          resourceId: 'source-evaluation',
          resourceContentHash:
            'sha256:3c5472ac70881363440979f779dac8ad657c662a6666495a5f667ef4a8a79879',
        },
      }),
    );

    expect(prepared.plan.plan).toEqual(
      expect.objectContaining({
        normalizedArguments: expect.objectContaining({
          skillId: 'evidence-research-workflow',
          resourceId: 'source-evaluation',
        }),
        resources: [
          expect.objectContaining({
            kind: 'product_skill_resource',
            id: 'source-evaluation',
          }),
        ],
      }),
    );
  });

  it('rejects a tool omitted from the frozen turn capability set', async () => {
    execution.payload.activeCapabilities.tools = [{ name: 'documents.search' }];

    await expect(
      service.prepare(
        invocation({
          name: 'user_tasks.create',
          arguments: { title: 'Hidden mutation' },
        }),
      ),
    ).rejects.toThrow('tool_not_available_for_turn');
    expect(planRepo.save).not.toHaveBeenCalled();
  });

  it('returns the same plan for an identical repeated invocation', async () => {
    const request = invocation();
    const storedInvocation = {
      toolCallId: TOOL_CALL_ID,
      invocationHash: canonicalHash(request),
    };
    const storedPlan = {
      operationId: TOOL_OPERATION_ID,
      toolCallId: TOOL_CALL_ID,
    };
    invocationRepo.findOne.mockResolvedValue(storedInvocation);
    planRepo.findOneBy.mockResolvedValue(storedPlan);

    await expect(service.prepare(request)).resolves.toEqual({
      invocation: storedInvocation,
      plan: storedPlan,
      duplicate: true,
    });
    expect(invocationRepo.save).not.toHaveBeenCalled();
  });

  it('prepares a task creation as a confirmable reversible effect', async () => {
    const prepared = await service.prepare(
      invocation({
        name: 'user_tasks.create',
        arguments: { title: 'Review harness', description: 'Check evidence' },
      }),
    );

    expect(prepared.plan.plan).toEqual(
      expect.objectContaining({
        toolName: 'user_tasks.create',
        normalizedArguments: {
          title: 'Review harness',
          description: 'Check evidence',
        },
        policyDecision: expect.objectContaining({
          decision: 'confirmation_required',
        }),
        confirmationRequirement: expect.objectContaining({
          confirmationId: expect.any(String),
          scope: 'once',
        }),
        recoveryClass: 'effect_checked',
      }),
    );
    expect(confirmations.createPending).toHaveBeenCalledWith(
      manager,
      execution,
      prepared.plan,
    );
    expect(stepRepo.save).not.toHaveBeenCalled();
  });

  it('prepares a bounded durable delegation without application effects', async () => {
    const prepared = await service.prepare(
      invocation({
        name: 'agents.delegate',
        arguments: { goal: 'Compare the two evidence sets' },
      }),
    );

    expect(prepared.plan.plan).toEqual(
      expect.objectContaining({
        toolName: 'agents.delegate',
        descriptorVersion: 'agents.delegate/1',
        normalizedArguments: { goal: 'Compare the two evidence sets' },
        effects: [],
        policyDecision: {
          decision: 'allowed',
          rule: 'bounded_internal_delegation',
          conditions: ['max_depth_1', 'single_inference', 'join_all'],
        },
        recoveryClass: 'idempotent',
        requiredCapabilities: ['tool.agents.delegate/1'],
      }),
    );
    expect(confirmations.createPending).toHaveBeenCalledWith(
      manager,
      execution,
      prepared.plan,
    );
  });

  it('prepares a paired browser read as governed read-only work', async () => {
    const prepared = await service.prepare(
      invocation({
        name: 'browser.read_current_page',
        arguments: {
          expectedUrl: '  https://example.test/page  ',
          maxChars: 12_000,
        },
      }),
    );

    expect(prepared.plan.plan).toEqual(
      expect.objectContaining({
        toolName: 'browser.read_current_page',
        descriptorVersion: 'browser.read_current_page/1',
        normalizedArguments: {
          expectedUrl: 'https://example.test/page',
          maxChars: 12_000,
        },
        resources: [
          {
            resourceKey: 'browser:active-page',
            mode: 'shared',
            kind: 'browser_page',
          },
        ],
        effects: [],
        policyDecision: {
          decision: 'allowed',
          rule: 'paired_browser_read',
        },
        confirmationRequirement: null,
        recoveryClass: 'read_only_replayable',
        requiredCapabilities: ['tool.browser.read_current_page/1'],
      }),
    );
  });

  it('rejects non-http browser targets', async () => {
    await expect(
      service.prepare(
        invocation({
          name: 'browser.read_current_page',
          arguments: { expectedUrl: 'file:///etc/passwd' },
        }),
      ),
    ).rejects.toThrow('invalid_arguments');
  });

  it('prepares browser navigation as a confirmed effect-checked operation', async () => {
    const prepared = await service.prepare(
      invocation({
        name: 'browser.navigate',
        arguments: {
          url: '  https://example.test/next  ',
          expectedCurrentUrl: 'https://example.test/current',
        },
      }),
    );

    expect(prepared.plan.plan).toEqual(
      expect.objectContaining({
        toolName: 'browser.navigate',
        descriptorVersion: 'browser.navigate/1',
        normalizedArguments: {
          url: 'https://example.test/next',
          expectedCurrentUrl: 'https://example.test/current',
        },
        resources: [
          {
            resourceKey: 'browser:active-page',
            mode: 'exclusive',
            kind: 'browser_page',
          },
        ],
        effects: [
          expect.objectContaining({
            effectClass: 'external_reversible',
            resourceKey: 'browser:active-page',
            verificationRequired: true,
          }),
        ],
        policyDecision: expect.objectContaining({
          decision: 'confirmation_required',
          rule: 'paired_browser_navigation_requires_confirmation',
        }),
        confirmationRequirement: expect.objectContaining({
          prompt: 'Navigate IA Browser to "https://example.test/next"?',
          scope: 'once',
        }),
        recoveryClass: 'effect_checked',
        idempotencyKey: `browser-navigate:${TOOL_CALL_ID}`,
        requiredCapabilities: ['tool.browser.navigate/1'],
      }),
    );
    expect(confirmations.createPending).toHaveBeenCalledWith(
      manager,
      execution,
      prepared.plan,
    );
  });

  it('rejects unsafe browser navigation URLs', async () => {
    await expect(
      service.prepare(
        invocation({
          name: 'browser.navigate',
          arguments: { url: 'javascript:alert(1)' },
        }),
      ),
    ).rejects.toThrow('invalid_arguments');
  });

  it('prepares browser history navigation as a confirmed checked effect', async () => {
    const prepared = await service.prepare(
      invocation({
        name: 'browser.go_back',
        arguments: {
          expectedCurrentUrl: '  https://example.test/current  ',
        },
      }),
    );

    expect(prepared.plan.plan).toEqual(
      expect.objectContaining({
        toolName: 'browser.go_back',
        descriptorVersion: 'browser.go_back/1',
        normalizedArguments: {
          expectedCurrentUrl: 'https://example.test/current',
        },
        resources: [
          {
            resourceKey: 'browser:active-page',
            mode: 'exclusive',
            kind: 'browser_page',
          },
        ],
        effects: [
          expect.objectContaining({
            effectClass: 'external_reversible',
            resourceKey: 'browser:active-page',
            verificationRequired: true,
          }),
        ],
        policyDecision: expect.objectContaining({
          decision: 'confirmation_required',
          rule: 'paired_browser_history_navigation_requires_confirmation',
        }),
        confirmationRequirement: expect.objectContaining({
          prompt: 'Go back from "https://example.test/current" in IA Browser?',
          scope: 'once',
        }),
        recoveryClass: 'effect_checked',
        idempotencyKey: `browser-go-back:${TOOL_CALL_ID}`,
        requiredCapabilities: ['tool.browser.go_back/1'],
      }),
    );
  });

  it('requires an exact current page for browser history navigation', async () => {
    await expect(
      service.prepare(
        invocation({
          name: 'browser.go_back',
          arguments: {},
        }),
      ),
    ).rejects.toThrow('invalid_arguments');
  });

  it('prepares an exact browser click as a confirmed irreversible effect', async () => {
    const prepared = await service.prepare(
      invocation({
        name: 'browser.click',
        arguments: {
          expectedCurrentUrl: '  https://example.test/current  ',
          elementIndex: 7,
          expectedKind: 'button',
          expectedLabel: '  Submit order  ',
        },
      }),
    );

    expect(prepared.plan.plan).toEqual(
      expect.objectContaining({
        toolName: 'browser.click',
        descriptorVersion: 'browser.click/1',
        normalizedArguments: {
          expectedCurrentUrl: 'https://example.test/current',
          elementIndex: 7,
          expectedKind: 'button',
          expectedLabel: 'Submit order',
        },
        resources: [
          {
            resourceKey: 'browser:active-page',
            mode: 'exclusive',
            kind: 'browser_page',
          },
        ],
        effects: [
          expect.objectContaining({
            effectClass: 'external_irreversible',
            resourceKey: 'browser:active-page',
            reversible: false,
            verificationRequired: true,
          }),
        ],
        policyDecision: expect.objectContaining({
          decision: 'confirmation_required',
          rule: 'paired_browser_click_requires_confirmation',
        }),
        confirmationRequirement: expect.objectContaining({
          prompt:
            'Click button "Submit order" (control 7) on "https://example.test/current"?',
          scope: 'once',
        }),
        recoveryClass: 'effect_checked',
        idempotencyKey: `browser-click:${TOOL_CALL_ID}`,
        requiredCapabilities: ['tool.browser.click/1'],
      }),
    );
  });

  it('rejects a browser click that does not exactly identify a visible control', async () => {
    await expect(
      service.prepare(
        invocation({
          name: 'browser.click',
          arguments: {
            expectedCurrentUrl: 'https://example.test/current',
            elementIndex: 7,
            expectedKind: 'field',
            expectedLabel: 'Search',
          },
        }),
      ),
    ).rejects.toThrow('invalid_arguments');
  });

  it('prepares exact browser text entry without form submission', async () => {
    const prepared = await service.prepare(
      invocation({
        name: 'browser.type_text',
        arguments: {
          expectedCurrentUrl: '  https://example.test/search  ',
          elementIndex: 8,
          expectedLabel: '  Search  ',
          expectedCurrentValue: 'old query',
          expectedCurrentValueTruncated: false,
          text: 'new query',
        },
      }),
    );

    expect(prepared.plan.plan).toEqual(
      expect.objectContaining({
        toolName: 'browser.type_text',
        descriptorVersion: 'browser.type_text/1',
        normalizedArguments: {
          expectedCurrentUrl: 'https://example.test/search',
          elementIndex: 8,
          expectedLabel: 'Search',
          expectedCurrentValue: 'old query',
          expectedCurrentValueTruncated: false,
          text: 'new query',
        },
        resources: [
          {
            resourceKey: 'browser:active-page',
            mode: 'exclusive',
            kind: 'browser_page',
          },
        ],
        effects: [
          expect.objectContaining({
            effectClass: 'external_irreversible',
            resourceKey: 'browser:active-page',
            reversible: false,
            verificationRequired: true,
          }),
        ],
        policyDecision: expect.objectContaining({
          decision: 'confirmation_required',
          rule: 'paired_browser_type_text_requires_confirmation',
        }),
        confirmationRequirement: expect.objectContaining({
          prompt: [
            'Type "new query" into field "Search" (control 8)',
            'on "https://example.test/search" without submitting?',
          ].join(' '),
          scope: 'once',
        }),
        recoveryClass: 'effect_checked',
        idempotencyKey: `browser-type-text:${TOOL_CALL_ID}`,
        requiredCapabilities: ['tool.browser.type_text/1'],
      }),
    );
  });

  it('rejects browser text entry that cannot be verified as short single-line text', async () => {
    await expect(
      service.prepare(
        invocation({
          name: 'browser.type_text',
          arguments: {
            expectedCurrentUrl: 'https://example.test/search',
            elementIndex: 8,
            expectedLabel: 'Search',
            expectedCurrentValue: '',
            expectedCurrentValueTruncated: false,
            text: 'two\nlines',
          },
        }),
      ),
    ).rejects.toThrow('invalid_arguments');
  });

  it('rejects browser text entry when the observed current value was truncated', async () => {
    await expect(
      service.prepare(
        invocation({
          name: 'browser.type_text',
          arguments: {
            expectedCurrentUrl: 'https://example.test/search',
            elementIndex: 8,
            expectedLabel: 'Search',
            expectedCurrentValue: 'partial value',
            expectedCurrentValueTruncated: true,
            text: 'new query',
          },
        }),
      ),
    ).rejects.toThrow('invalid_arguments');
  });

  it('prepares an exact browser option selection without form submission', async () => {
    const prepared = await service.prepare(
      invocation({
        name: 'browser.select_option',
        arguments: {
          expectedCurrentUrl: 'https://example.test/profile',
          elementIndex: 9,
          expectedLabel: 'Country',
          expectedCurrentValue: 'es',
          expectedCurrentValueTruncated: false,
          optionValue: 'pt',
          expectedOptionLabel: 'Portugal',
        },
      }),
    );
    expect(prepared.plan.plan).toEqual(
      expect.objectContaining({
        toolName: 'browser.select_option',
        descriptorVersion: 'browser.select_option/1',
        normalizedArguments: {
          expectedCurrentUrl: 'https://example.test/profile',
          elementIndex: 9,
          expectedLabel: 'Country',
          expectedCurrentValue: 'es',
          expectedCurrentValueTruncated: false,
          optionValue: 'pt',
          expectedOptionLabel: 'Portugal',
        },
        policyDecision: expect.objectContaining({
          decision: 'confirmation_required',
          rule: 'paired_browser_select_option_requires_confirmation',
        }),
        recoveryClass: 'effect_checked',
        idempotencyKey: `browser-select-option:${TOOL_CALL_ID}`,
        requiredCapabilities: ['tool.browser.select_option/1'],
      }),
    );
  });

  it('prepares a working-folder read for the personal assistant', async () => {
    execution.taskType = 'assistant-chat';
    execution.payload = {
      ...execution.payload,
      ownerId: 1,
      folderScope: '/workspace/project',
    };

    const prepared = await service.prepare(
      invocation({
        name: 'workspace_files.read',
        arguments: { filename: 'notes.md', maxChars: 6_000 },
      }),
    );

    expect(prepared.plan.plan).toEqual(
      expect.objectContaining({
        toolName: 'workspace_files.read',
        normalizedArguments: {
          ownerType: 'assistant',
          ownerId: 1,
          scopeKey: expect.any(String),
          filename: 'notes.md',
          offset: 0,
          maxChars: 6_000,
        },
        policyDecision: {
          decision: 'allowed',
          rule: 'working_folder_read',
        },
        recoveryClass: 'read_only_replayable',
        requiredCapabilities: ['tool.workspace_files.read/1'],
      }),
    );
  });

  it('prepares an agent working-folder write as a confirmed verified effect', async () => {
    execution.taskType = 'agent-chat';
    execution.payload = {
      ...execution.payload,
      ownerId: 42,
      folderScope: '/workspace/project',
    };

    const prepared = await service.prepare(
      invocation({
        name: 'workspace_files.write',
        arguments: {
          filename: 'notes.md',
          content: '# Updated',
          overwrite: true,
        },
      }),
    );

    expect(prepared.plan.plan).toEqual(
      expect.objectContaining({
        toolName: 'workspace_files.write',
        normalizedArguments: {
          ownerType: 'agent',
          ownerId: 42,
          scopeKey: expect.any(String),
          filename: 'notes.md',
          content: '# Updated',
          overwrite: true,
        },
        effects: [
          expect.objectContaining({
            effectClass: 'local_destructive',
            verificationRequired: true,
          }),
        ],
        policyDecision: expect.objectContaining({
          decision: 'confirmation_required',
          rule: 'working_folder_write_requires_confirmation',
        }),
        recoveryClass: 'effect_checked',
        requiredCapabilities: ['tool.workspace_files.write/1'],
      }),
    );
  });

  it('prepares indexed folder search as optional scoped context', async () => {
    execution.taskType = 'assistant-chat';
    execution.payload = {
      ...execution.payload,
      ownerId: 1,
      folderScope: '/workspace/project',
    };

    const prepared = await service.prepare(
      invocation({
        name: 'workspace_files.search',
        arguments: { query: 'quarterly revenue', limit: 5 },
      }),
    );

    expect(prepared.plan.plan).toEqual(
      expect.objectContaining({
        toolName: 'workspace_files.search',
        normalizedArguments: {
          ownerType: 'assistant',
          ownerId: 1,
          scopeKey: expect.any(String),
          query: 'quarterly revenue',
          limit: 5,
        },
        effects: [],
        policyDecision: {
          decision: 'allowed',
          rule: 'working_folder_search',
        },
        requiredCapabilities: ['tool.workspace_files.search/1'],
      }),
    );
  });

  it('accepts binary content and prepares deletion as a destructive effect', async () => {
    execution.taskType = 'agent-chat';
    execution.payload = {
      ...execution.payload,
      ownerId: 42,
      folderScope: '/workspace/project',
    };

    const binary = await service.prepare(
      invocation({
        name: 'workspace_files.write',
        arguments: {
          filename: 'report.pdf',
          contentBase64: Buffer.from('%PDF-1.7').toString('base64'),
        },
      }),
    );
    expect(binary.plan.plan.normalizedArguments).toEqual(
      expect.objectContaining({
        filename: 'report.pdf',
        contentBase64: Buffer.from('%PDF-1.7').toString('base64'),
      }),
    );

    const deletion = await service.prepare(
      invocation({
        toolCallId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca799',
        name: 'workspace_files.delete',
        arguments: { filename: 'report.pdf' },
      }),
    );
    expect(deletion.plan.plan).toEqual(
      expect.objectContaining({
        toolName: 'workspace_files.delete',
        effects: [
          expect.objectContaining({
            effectClass: 'local_destructive',
            reversible: false,
            verificationRequired: true,
          }),
        ],
        policyDecision: expect.objectContaining({
          decision: 'confirmation_required',
          rule: 'working_folder_delete_requires_confirmation',
        }),
        requiredCapabilities: ['tool.workspace_files.delete/1'],
      }),
    );
  });

  it('uses the same physical resource lock when different owners share a folder', async () => {
    execution.taskType = 'assistant-chat';
    execution.payload = {
      ...execution.payload,
      ownerId: 1,
      folderScope: '/workspace/shared',
    };
    const assistantRead = await service.prepare(
      invocation({
        name: 'workspace_files.read',
        arguments: { filename: 'shared.docx' },
      }),
    );

    execution.taskType = 'agent-chat';
    execution.payload = {
      ...execution.payload,
      ownerId: 42,
      folderScope: '/workspace/shared',
    };
    const agentWrite = await service.prepare(
      invocation({
        toolCallId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca798',
        name: 'workspace_files.write',
        arguments: { filename: 'shared.docx', content: 'replacement' },
      }),
    );

    expect(assistantRead.plan.plan.resources[0].resourceKey).toBe(
      agentWrite.plan.plan.resources[0].resourceKey,
    );
  });

  it('rejects working-folder tools when the chat has no configured folder', async () => {
    execution.taskType = 'assistant-chat';
    execution.payload = { ...execution.payload, ownerId: 1, folderScope: null };

    await expect(
      service.prepare(
        invocation({
          name: 'workspace_files.read',
          arguments: { filename: 'notes.md' },
        }),
      ),
    ).rejects.toThrow('working_folder_not_configured');
  });

  it('rejects reuse of a tool call identity with different arguments', async () => {
    invocationRepo.findOne.mockResolvedValue({
      toolCallId: TOOL_CALL_ID,
      invocationHash: canonicalHash(invocation()),
    });

    await expect(
      service.prepare(invocation({ arguments: { query: 'different' } })),
    ).rejects.toThrow('idempotency_conflict');
  });

  it('materializes the accepted plan only with its reserved budget', async () => {
    const plan = planContract();
    const storedPlan = {
      operationId: TOOL_OPERATION_ID,
      executionId: EXECUTION_ID,
      toolCallId: TOOL_CALL_ID,
      stepId: null,
      plan,
      materializedAt: null,
    };
    execution.progressLedger = {
      operationBudget: {
        grants: {},
        reservations: {
          [TOOL_OPERATION_ID]: {
            reservationId: RESERVATION_ID,
            operationId: TOOL_OPERATION_ID,
            operationKind: 'tool_call',
            toolCallId: TOOL_CALL_ID,
            status: 'reserved',
          },
        },
      },
    };
    planRepo.findOne.mockResolvedValue(storedPlan);
    invocationRepo.findOneBy.mockResolvedValue({
      toolCallId: TOOL_CALL_ID,
      causedByEventId: EVENT_ID,
      invocation: invocation(),
    });

    const step = await service.materialize(TOOL_CALL_ID, RESERVATION_ID);

    expect(step).toEqual(
      expect.objectContaining({
        stepKind: ExecutionStepKind.TOOL,
        operationId: TOOL_OPERATION_ID,
        budgetReservationId: RESERVATION_ID,
        requiredCapabilities: ['tool.documents.search/1'],
        resourceKeys: ['documents:collection'],
      }),
    );
    expect(operationRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: TOOL_OPERATION_ID,
        status: ExecutionOperationStatus.PREPARED,
        recoveryClass: ExecutionOperationRecoveryClass.READ_ONLY_REPLAYABLE,
      }),
    );
    expect(storedPlan.stepId).toBe(step.stepId);
    expect(execution.phase).toBeNull();
  });

  it('does not materialize a plan without a matching reservation', async () => {
    planRepo.findOne.mockResolvedValue({
      operationId: TOOL_OPERATION_ID,
      executionId: EXECUTION_ID,
      toolCallId: TOOL_CALL_ID,
      stepId: null,
      plan: planContract(),
    });

    await expect(
      service.materialize(TOOL_CALL_ID, RESERVATION_ID),
    ).rejects.toThrow('tool_budget_not_reserved');
    expect(stepRepo.save).not.toHaveBeenCalled();
    expect(operationRepo.save).not.toHaveBeenCalled();
  });

  it('materializes approved browser navigation with its durable decision', async () => {
    const confirmationId = '018f1d8a-54d7-7d63-a1ee-5e9a6adca709';
    const plan: ToolPlanContract = {
      ...planContract(),
      toolName: 'browser.navigate',
      descriptorVersion: 'browser.navigate/1',
      normalizedArguments: {
        url: 'https://example.test/next',
        expectedCurrentUrl: 'https://example.test/current',
      },
      resources: [
        {
          resourceKey: 'browser:active-page',
          mode: 'exclusive',
          kind: 'browser_page',
        },
      ],
      effects: [
        {
          effectClass: 'external_reversible',
          resourceKey: 'browser:active-page',
          description: 'Navigate IA Browser',
          reversible: true,
          verificationRequired: true,
        },
      ],
      policyDecision: {
        decision: 'confirmation_required',
        rule: 'paired_browser_navigation_requires_confirmation',
      },
      confirmationRequirement: {
        confirmationId,
        reason: 'Navigation changes the active page.',
        prompt: 'Navigate?',
        scope: 'once',
      },
      recoveryClass: 'effect_checked',
      idempotencyKey: `browser-navigate:${TOOL_CALL_ID}`,
      requiredCapabilities: ['tool.browser.navigate/1'],
    };
    execution.progressLedger = {
      operationBudget: {
        grants: {},
        reservations: {
          [TOOL_OPERATION_ID]: {
            reservationId: RESERVATION_ID,
            operationId: TOOL_OPERATION_ID,
            operationKind: 'tool_call',
            toolCallId: TOOL_CALL_ID,
            status: 'reserved',
          },
        },
      },
    };
    planRepo.findOne.mockResolvedValue({
      operationId: TOOL_OPERATION_ID,
      executionId: EXECUTION_ID,
      toolCallId: TOOL_CALL_ID,
      stepId: null,
      plan,
    });
    invocationRepo.findOneBy.mockResolvedValue({
      toolCallId: TOOL_CALL_ID,
      causedByEventId: EVENT_ID,
      invocation: invocation({ name: 'browser.navigate' }),
    });
    confirmations.decisionForPlan.mockResolvedValue({
      confirmationId,
      planHash: canonicalHash(plan),
      status: 'approved',
      decidedAt: new Date('2026-08-26T10:00:00.000Z'),
    });

    const step = await service.materialize(TOOL_CALL_ID, RESERVATION_ID);

    expect(step).toEqual(
      expect.objectContaining({
        requiredCapabilities: ['tool.browser.navigate/1'],
        resourceKeys: ['browser:active-page'],
        work: expect.objectContaining({
          taskType: 'browser.navigate',
          confirmationDecision: expect.objectContaining({
            confirmationId,
            status: 'approved',
          }),
        }),
      }),
    );
    expect(operationRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        recoveryClass: ExecutionOperationRecoveryClass.EFFECT_CHECKED,
      }),
    );
  });

  it('rejects recursive delegation before creating another child', async () => {
    const plan = {
      ...planContract(),
      toolName: 'agents.delegate',
      descriptorVersion: 'agents.delegate/1',
      normalizedArguments: { goal: 'Delegate again' },
      requiredCapabilities: ['tool.agents.delegate/1'],
    };
    execution.parentExecutionId = '018f1d8a-54d7-7d63-a1ee-5e9a6adca799';
    execution.progressLedger = {
      operationBudget: {
        grants: {},
        reservations: {
          [TOOL_OPERATION_ID]: {
            reservationId: RESERVATION_ID,
            operationId: TOOL_OPERATION_ID,
            operationKind: 'tool_call',
            toolCallId: TOOL_CALL_ID,
            status: 'reserved',
          },
        },
      },
    };
    planRepo.findOne.mockResolvedValue({
      operationId: TOOL_OPERATION_ID,
      executionId: EXECUTION_ID,
      toolCallId: TOOL_CALL_ID,
      stepId: null,
      plan,
    });
    invocationRepo.findOneBy.mockResolvedValue({
      toolCallId: TOOL_CALL_ID,
      causedByEventId: EVENT_ID,
      invocation: invocation({ name: 'agents.delegate' }),
    });

    await expect(
      service.materialize(TOOL_CALL_ID, RESERVATION_ID),
    ).rejects.toThrow('delegation_depth_exceeded');
    expect(executions.createChildInference).not.toHaveBeenCalled();
  });

  it('keeps confirmable work unmaterialized while the decision is pending', async () => {
    const plan = {
      ...planContract(),
      policyDecision: {
        decision: 'confirmation_required' as const,
        rule: 'user_task_create_requires_confirmation',
      },
      confirmationRequirement: {
        confirmationId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca709',
        reason: 'Local mutation',
        prompt: 'Create task?',
        scope: 'once' as const,
      },
    };
    planRepo.findOne.mockResolvedValue({
      operationId: TOOL_OPERATION_ID,
      executionId: EXECUTION_ID,
      toolCallId: TOOL_CALL_ID,
      stepId: null,
      plan,
    });
    confirmations.decisionForPlan.mockResolvedValue({ status: 'pending' });

    await expect(
      service.materialize(TOOL_CALL_ID, RESERVATION_ID),
    ).resolves.toBeNull();
    expect(stepRepo.save).not.toHaveBeenCalled();
  });

  it('exposes a pending confirmation before any budget is reserved', async () => {
    const plan = {
      ...planContract(),
      policyDecision: {
        decision: 'confirmation_required' as const,
        rule: 'user_task_create_requires_confirmation',
      },
      confirmationRequirement: {
        confirmationId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca709',
        reason: 'Local mutation',
        prompt: 'Create task?',
        scope: 'once' as const,
      },
    };
    planRepo.findOneBy.mockResolvedValue({
      operationId: TOOL_OPERATION_ID,
      executionId: EXECUTION_ID,
      toolCallId: TOOL_CALL_ID,
      stepId: null,
      plan,
    });
    confirmations.decisionForPlan.mockResolvedValue({ status: 'pending' });

    await expect(
      service.getMaterializationDisposition(TOOL_CALL_ID),
    ).resolves.toEqual({ kind: 'waiting_confirmation' });
  });

  it('materializes one not-executed result when confirmation is denied', async () => {
    const plan = {
      ...planContract(),
      policyDecision: {
        decision: 'confirmation_required' as const,
        rule: 'user_task_create_requires_confirmation',
      },
      confirmationRequirement: {
        confirmationId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca709',
        reason: 'Local mutation',
        prompt: 'Create task?',
        scope: 'once' as const,
      },
    };
    const storedPlan = {
      operationId: TOOL_OPERATION_ID,
      executionId: EXECUTION_ID,
      toolCallId: TOOL_CALL_ID,
      toolName: 'user_tasks.create',
      stepId: null,
      plan,
      materializedAt: null,
    };
    planRepo.findOne.mockResolvedValue(storedPlan);
    invocationRepo.findOneBy.mockResolvedValue({
      toolCallId: TOOL_CALL_ID,
      causedByEventId: EVENT_ID,
      invocation: invocation({ name: 'user_tasks.create' }),
    });
    confirmations.decisionForPlan.mockResolvedValue({ status: 'denied' });

    const step = await service.materialize(TOOL_CALL_ID, RESERVATION_ID);

    expect(step).toEqual(
      expect.objectContaining({
        status: ExecutionStepStatus.COMPLETED,
        budgetReservationId: null,
        requiredCapabilities: [],
        result: {
          kind: ExecutionStepKind.TOOL,
          toolResult: expect.objectContaining({
            toolCallId: TOOL_CALL_ID,
            status: 'not_executed',
            error: expect.objectContaining({
              code: 'tool_confirmation_denied',
              retryable: false,
            }),
          }),
        },
      }),
    );
    expect(operationRepo.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: ExecutionOperationStatus.NOT_EXECUTED,
      }),
    );
    expect(storedPlan.stepId).toBe(step.stepId);
  });
});

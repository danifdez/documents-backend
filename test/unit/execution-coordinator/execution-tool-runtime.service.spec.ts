import { ExecutionToolRuntimeService } from '../../../src/execution-coordinator/execution-tool-runtime.service';
import { ExecutionStepKind } from '../../../src/execution/execution-step-kind.enum';
import { canonicalHash } from '../../../src/execution/execution-canonical';

const EXECUTION_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca701';
const STEP_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca702';
const OPERATION_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca703';
const ATTEMPT_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca704';
const TOOL_CALL_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca705';
const CHILD_EXECUTION_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca706';

describe('ExecutionToolRuntimeService', () => {
  let attempts: Record<string, jest.Mock>;
  let contracts: Record<string, jest.Mock>;
  let search: Record<string, jest.Mock>;
  let userTasks: Record<string, jest.Mock>;
  let executions: Record<string, jest.Mock>;
  let service: ExecutionToolRuntimeService;

  const assignment = () => ({
    schemaVersion: 'step-assignment/1' as const,
    executionId: EXECUTION_ID,
    stepId: STEP_ID,
    operationId: OPERATION_ID,
    attemptId: ATTEMPT_ID,
    stepKind: ExecutionStepKind.TOOL,
    dependsOnStepIds: [],
    inputArtifactRefs: [],
    work: {
      taskType: 'documents.search',
      toolPlan: {
        schemaVersion: 'tool-plan/1',
        operationId: OPERATION_ID,
        toolCallId: TOOL_CALL_ID,
        toolName: 'documents.search',
        descriptorVersion: 'documents.search/1',
        normalizedArguments: { query: 'durable tools', limit: 2 },
        resources: [
          {
            resourceKey: 'documents:collection',
            mode: 'shared',
          },
        ],
        effects: [],
        policyDecision: { decision: 'allowed', rule: 'local_documents_read' },
        confirmationRequirement: null,
        recoveryClass: 'read_only_replayable',
        idempotencyKey: null,
        requiredCapabilities: ['tool.documents.search/1'],
        deadline: '2026-08-25T00:00:00.000Z',
        preparedAt: '2026-08-24T23:59:30.000Z',
      },
    },
    limits: { maxDurationMs: 30_000 },
    deadline: '2026-08-25T00:00:00.000Z',
  });

  const taskAssignment = (status: 'approved' | 'denied') => {
    const plan = {
      schemaVersion: 'tool-plan/1' as const,
      operationId: OPERATION_ID,
      toolCallId: TOOL_CALL_ID,
      toolName: 'user_tasks.create',
      descriptorVersion: 'user_tasks.create/1',
      normalizedArguments: { title: 'Review harness', description: null },
      resources: [
        {
          resourceKey: 'user-tasks:collection',
          mode: 'exclusive' as const,
        },
      ],
      effects: [
        {
          effectClass: 'local_reversible' as const,
          resourceKey: 'user-tasks:collection',
          description: 'Create task: Review harness',
          reversible: true,
          verificationRequired: true,
        },
      ],
      policyDecision: {
        decision: 'confirmation_required' as const,
        rule: 'user_task_create_requires_confirmation',
      },
      confirmationRequirement: {
        confirmationId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca706',
        reason: 'Local mutation',
        prompt: 'Create the task?',
        scope: 'once' as const,
      },
      recoveryClass: 'effect_checked' as const,
      idempotencyKey: `user-task:${TOOL_CALL_ID}`,
      requiredCapabilities: ['tool.user_tasks.create/1'],
      deadline: '2026-08-25T00:15:00.000Z',
      preparedAt: '2026-08-25T00:00:00.000Z',
    };
    return {
      ...assignment(),
      work: {
        taskType: 'user_tasks.create',
        toolPlan: plan,
        confirmationDecision: {
          confirmationId: plan.confirmationRequirement.confirmationId,
          planHash: canonicalHash(plan),
          status,
          decidedAt: '2026-08-25T00:01:00.000Z',
        },
      },
    };
  };

  const delegationAssignment = () => ({
    ...assignment(),
    work: {
      taskType: 'agents.delegate',
      childExecutionId: CHILD_EXECUTION_ID,
      childStepId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca707',
      joinPolicy: 'all',
      delegationDepth: 1,
      toolPlan: {
        schemaVersion: 'tool-plan/1' as const,
        operationId: OPERATION_ID,
        toolCallId: TOOL_CALL_ID,
        toolName: 'agents.delegate',
        descriptorVersion: 'agents.delegate/1',
        normalizedArguments: { goal: 'Compare evidence' },
        resources: [
          {
            resourceKey: `execution-tree:${EXECUTION_ID}`,
            mode: 'shared' as const,
          },
        ],
        effects: [],
        policyDecision: {
          decision: 'allowed' as const,
          rule: 'bounded_internal_delegation',
          conditions: ['max_depth_1', 'single_inference', 'join_all'],
        },
        confirmationRequirement: null,
        recoveryClass: 'idempotent' as const,
        idempotencyKey: `delegation:${TOOL_CALL_ID}`,
        requiredCapabilities: ['tool.agents.delegate/1'],
        deadline: '2026-08-25T00:10:00.000Z',
        preparedAt: '2026-08-25T00:00:00.000Z',
      },
    },
  });

  beforeEach(() => {
    attempts = {
      claimReadyStep: jest
        .fn()
        .mockResolvedValueOnce(assignment())
        .mockResolvedValueOnce(null),
      startAttempt: jest.fn().mockResolvedValue({}),
      receiveResult: jest.fn().mockResolvedValue({ code: 'received' }),
    };
    contracts = {
      assertToolPlan: jest.fn(),
      assertToolResult: jest.fn(),
    };
    search = {
      globalSearch: jest.fn().mockResolvedValue([
        { id: 7, name: 'Harness plan', score: 0.9, collection: 'docs' },
        { id: 9, name: 'Runtime notes', score: 0.8, collection: 'notes' },
        { id: 11, name: 'Ignored result', score: 0.7, collection: 'docs' },
      ]),
    };
    userTasks = {
      createFromExecution: jest.fn(),
      findByExecutionOperation: jest.fn(),
    };
    executions = { findOne: jest.fn() };
    service = new ExecutionToolRuntimeService(
      attempts as any,
      contracts as any,
      search as any,
      userTasks as any,
      executions as any,
    );
  });

  it('executes a prepared search through attempt and receipt boundaries', async () => {
    await expect(service.executeReady()).resolves.toBe(1);

    expect(attempts.claimReadyStep).toHaveBeenCalledWith({
      workerId: '00000000-0000-4000-8000-000000000001',
      stepKinds: [ExecutionStepKind.TOOL],
      capabilities: [
        'tool.documents.search/1',
        'tool.user_tasks.create/1',
        'tool.agents.delegate/1',
      ],
      leaseDurationMs: 30_000,
    });
    expect(search.globalSearch).toHaveBeenCalledWith('durable tools');
    expect(attempts.receiveResult).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: EXECUTION_ID,
        stepId: STEP_ID,
        operationId: OPERATION_ID,
        attemptId: ATTEMPT_ID,
        result: expect.objectContaining({
          stepKind: ExecutionStepKind.TOOL,
          status: 'succeeded',
          output: {
            kind: ExecutionStepKind.TOOL,
            toolResult: expect.objectContaining({
              schemaVersion: 'tool-result/1',
              operationId: OPERATION_ID,
              toolCallId: TOOL_CALL_ID,
              status: 'succeeded',
              structuredContent: expect.objectContaining({ count: 2 }),
              effects: [],
              error: null,
            }),
          },
        }),
      }),
    );
  });

  it('returns a canonical failed result when search fails', async () => {
    search.globalSearch.mockRejectedValue(new Error('database unavailable'));

    await expect(service.executeReady()).resolves.toBe(1);
    expect(attempts.receiveResult).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          status: 'failed',
          output: {
            kind: ExecutionStepKind.TOOL,
            toolResult: expect.objectContaining({
              status: 'failed',
              error: expect.objectContaining({ code: 'tool_execution_failed' }),
            }),
          },
          error: expect.objectContaining({ code: 'tool_execution_failed' }),
        }),
      }),
    );
  });

  it('does not apply a task effect after confirmation is denied', async () => {
    attempts.claimReadyStep
      .mockReset()
      .mockResolvedValueOnce(taskAssignment('denied'))
      .mockResolvedValueOnce(null);

    await expect(service.executeReady()).resolves.toBe(1);

    expect(userTasks.createFromExecution).not.toHaveBeenCalled();
    expect(attempts.receiveResult).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          status: 'succeeded',
          output: {
            kind: ExecutionStepKind.TOOL,
            toolResult: expect.objectContaining({
              status: 'not_executed',
              structuredContent: { confirmationStatus: 'denied' },
              effects: [expect.objectContaining({ status: 'not_applied' })],
            }),
          },
        }),
      }),
    );
  });

  it('creates and verifies a task only after confirmation is approved', async () => {
    attempts.claimReadyStep
      .mockReset()
      .mockResolvedValueOnce(taskAssignment('approved'))
      .mockResolvedValueOnce(null);
    const task = { id: 17, title: 'Review harness', status: 'pending' };
    userTasks.createFromExecution.mockResolvedValue(task);
    userTasks.findByExecutionOperation.mockResolvedValue(task);

    await expect(service.executeReady()).resolves.toBe(1);

    expect(userTasks.createFromExecution).toHaveBeenCalledWith(
      OPERATION_ID,
      'Review harness',
      null,
    );
    expect(attempts.receiveResult).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          status: 'succeeded',
          output: {
            kind: ExecutionStepKind.TOOL,
            toolResult: expect.objectContaining({
              status: 'succeeded',
              structuredContent: expect.objectContaining({ id: 17 }),
              effects: [expect.objectContaining({ status: 'applied' })],
            }),
          },
        }),
      }),
    );
  });

  it('joins a completed child execution into a canonical tool result', async () => {
    attempts.claimReadyStep
      .mockReset()
      .mockResolvedValueOnce(delegationAssignment())
      .mockResolvedValueOnce(null);
    executions.findOne.mockResolvedValue({
      executionId: CHILD_EXECUTION_ID,
      parentExecutionId: EXECUTION_ID,
      status: 'completed',
      payload: { delegationOperationId: OPERATION_ID },
      result: { reply: 'Independent comparison' },
    });

    await expect(service.executeReady()).resolves.toBe(1);

    expect(attempts.receiveResult).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          status: 'succeeded',
          output: {
            kind: ExecutionStepKind.TOOL,
            toolResult: expect.objectContaining({
              status: 'succeeded',
              content: 'Independent comparison',
              structuredContent: {
                childExecutionId: CHILD_EXECUTION_ID,
                childStatus: 'completed',
                joinPolicy: 'all',
              },
            }),
          },
        }),
      }),
    );
  });
});

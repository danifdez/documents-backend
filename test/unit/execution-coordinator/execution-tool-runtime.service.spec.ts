import { ExecutionToolRuntimeService } from '../../../src/execution-coordinator/execution-tool-runtime.service';
import { ExecutionStepKind } from '../../../src/execution/execution-step-kind.enum';
import { canonicalHash } from '../../../src/execution/execution-canonical';

const EXECUTION_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca701';
const STEP_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca702';
const OPERATION_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca703';
const ATTEMPT_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca704';
const TOOL_CALL_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca705';
const CHILD_EXECUTION_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca706';
const SCOPE_KEY = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('ExecutionToolRuntimeService', () => {
  let attempts: Record<string, jest.Mock>;
  let contracts: Record<string, jest.Mock>;
  let search: Record<string, jest.Mock>;
  let userTasks: Record<string, jest.Mock>;
  let indexedFiles: Record<string, jest.Mock>;
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

  const workspaceReadAssignment = () => ({
    ...assignment(),
    work: {
      taskType: 'workspace_files.read',
      toolPlan: {
        schemaVersion: 'tool-plan/1' as const,
        operationId: OPERATION_ID,
        toolCallId: TOOL_CALL_ID,
        toolName: 'workspace_files.read',
        descriptorVersion: 'workspace_files.read/1',
        normalizedArguments: {
          ownerType: 'assistant',
          ownerId: 1,
          scopeKey: SCOPE_KEY,
          filename: 'notes.md',
          offset: 0,
          maxChars: 8_000,
        },
        resources: [],
        effects: [],
        policyDecision: {
          decision: 'allowed' as const,
          rule: 'working_folder_read',
        },
        confirmationRequirement: null,
        recoveryClass: 'read_only_replayable' as const,
        idempotencyKey: null,
        requiredCapabilities: ['tool.workspace_files.read/1'],
        deadline: '2026-08-25T00:10:00.000Z',
        preparedAt: '2026-08-25T00:00:00.000Z',
      },
    },
  });

  const workspaceWriteAssignment = () => {
    const plan = {
      schemaVersion: 'tool-plan/1' as const,
      operationId: OPERATION_ID,
      toolCallId: TOOL_CALL_ID,
      toolName: 'workspace_files.write',
      descriptorVersion: 'workspace_files.write/1',
      normalizedArguments: {
        ownerType: 'agent',
        ownerId: 42,
        scopeKey: SCOPE_KEY,
        filename: 'notes.md',
        content: '# Updated',
        overwrite: true,
      },
      resources: [],
      effects: [
        {
          effectClass: 'local_destructive' as const,
          resourceKey: 'working-folder:agent:42:notes.md',
          description: 'Replace file: notes.md',
          reversible: false,
          verificationRequired: true,
        },
      ],
      policyDecision: {
        decision: 'confirmation_required' as const,
        rule: 'working_folder_write_requires_confirmation',
      },
      confirmationRequirement: {
        confirmationId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca706',
        reason: 'Local mutation',
        prompt: 'Replace the file?',
        scope: 'once' as const,
      },
      recoveryClass: 'effect_checked' as const,
      idempotencyKey: `working-file:${TOOL_CALL_ID}`,
      requiredCapabilities: ['tool.workspace_files.write/1'],
      deadline: '2026-08-25T00:15:00.000Z',
      preparedAt: '2026-08-25T00:00:00.000Z',
    };
    return {
      ...assignment(),
      work: {
        taskType: 'workspace_files.write',
        toolPlan: plan,
        confirmationDecision: {
          confirmationId: plan.confirmationRequirement.confirmationId,
          planHash: canonicalHash(plan),
          status: 'approved',
          decidedAt: '2026-08-25T00:01:00.000Z',
        },
      },
    };
  };

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
    indexedFiles = {
      readWithSync: jest.fn(),
      scanFolder: jest.fn(),
      findByOwner: jest.fn(),
      folderScopeKey: jest.fn().mockResolvedValue(SCOPE_KEY),
      search: jest.fn(),
      writeFile: jest.fn(),
      readContent: jest.fn(),
      getByFilename: jest.fn(),
      deleteByFilename: jest.fn(),
    };
    service = new ExecutionToolRuntimeService(
      attempts as any,
      contracts as any,
      search as any,
      userTasks as any,
      indexedFiles as any,
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
        'tool.workspace_files.read/1',
        'tool.workspace_files.list/1',
        'tool.workspace_files.search/1',
        'tool.workspace_files.write/1',
        'tool.workspace_files.delete/1',
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

  it('reads a file through the trusted assistant working-folder owner', async () => {
    attempts.claimReadyStep
      .mockReset()
      .mockResolvedValueOnce(workspaceReadAssignment())
      .mockResolvedValueOnce(null);
    indexedFiles.readWithSync.mockResolvedValue({
      ok: true,
      indexedFileId: 7,
      filename: 'notes.md',
      content: '# Notes',
      mimeType: 'text/markdown',
      size: 7,
      mtime: new Date('2026-08-25T00:00:00.000Z'),
    });

    await expect(service.executeReady()).resolves.toBe(1);

    expect(indexedFiles.readWithSync).toHaveBeenCalledWith(
      { ownerType: 'assistant', ownerId: 1 },
      { filename: 'notes.md' },
    );
    expect(attempts.receiveResult).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          output: {
            kind: ExecutionStepKind.TOOL,
            toolResult: expect.objectContaining({
              status: 'succeeded',
              content: '# Notes',
            }),
          },
        }),
      }),
    );
  });

  it('writes and verifies a file only after exact-plan confirmation', async () => {
    attempts.claimReadyStep
      .mockReset()
      .mockResolvedValueOnce(workspaceWriteAssignment())
      .mockResolvedValueOnce(null);
    indexedFiles.writeFile.mockResolvedValue({
      id: 8,
      filename: 'notes.md',
      size: 9,
      checksum: 'checksum',
    });
    indexedFiles.readContent.mockResolvedValue({
      content: Buffer.from('# Updated'),
    });

    await expect(service.executeReady()).resolves.toBe(1);

    expect(indexedFiles.writeFile).toHaveBeenCalledWith(
      { ownerType: 'agent', ownerId: 42 },
      'notes.md',
      Buffer.from('# Updated'),
      { overwrite: true },
    );
    expect(attempts.receiveResult).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          output: {
            kind: ExecutionStepKind.TOOL,
            toolResult: expect.objectContaining({
              status: 'succeeded',
              effects: [expect.objectContaining({ status: 'applied' })],
            }),
          },
        }),
      }),
    );
  });

  it('retrieves indexed folder context through the scoped owner', async () => {
    const request: any = workspaceReadAssignment();
    request.work.taskType = 'workspace_files.search';
    request.work.toolPlan.toolName = 'workspace_files.search';
    request.work.toolPlan.descriptorVersion = 'workspace_files.search/1';
    request.work.toolPlan.normalizedArguments = {
      ownerType: 'assistant',
      ownerId: 1,
      scopeKey: SCOPE_KEY,
      query: 'quarterly revenue',
      limit: 5,
    };
    request.work.toolPlan.policyDecision.rule = 'working_folder_search';
    request.work.toolPlan.requiredCapabilities = [
      'tool.workspace_files.search/1',
    ];
    attempts.claimReadyStep
      .mockReset()
      .mockResolvedValueOnce(request)
      .mockResolvedValueOnce(null);
    indexedFiles.scanFolder.mockResolvedValue({
      status: 'done',
      added: 0,
      updated: 0,
      removed: 0,
    });
    indexedFiles.search.mockResolvedValue([
      {
        indexedFileId: 9,
        filename: 'report.pdf',
        snippet: 'Revenue increased',
        score: 0.9,
      },
    ]);

    await expect(service.executeReady()).resolves.toBe(1);

    expect(indexedFiles.search).toHaveBeenCalledWith(
      { ownerType: 'assistant', ownerId: 1 },
      'quarterly revenue',
      5,
    );
  });

  it('deletes and verifies a file only after exact-plan confirmation', async () => {
    const request: any = workspaceWriteAssignment();
    const plan = request.work.toolPlan;
    request.work.taskType = 'workspace_files.delete';
    plan.toolName = 'workspace_files.delete';
    plan.descriptorVersion = 'workspace_files.delete/1';
    plan.normalizedArguments = {
      ownerType: 'agent',
      ownerId: 42,
      scopeKey: SCOPE_KEY,
      filename: 'report.pdf',
    };
    plan.effects[0].resourceKey = 'working-folder:agent:42:report.pdf';
    plan.effects[0].description = 'Delete file: report.pdf';
    plan.requiredCapabilities = ['tool.workspace_files.delete/1'];
    plan.policyDecision.rule = 'working_folder_delete_requires_confirmation';
    request.work.confirmationDecision.planHash = canonicalHash(plan);
    attempts.claimReadyStep
      .mockReset()
      .mockResolvedValueOnce(request)
      .mockResolvedValueOnce(null);
    indexedFiles.getByFilename
      .mockResolvedValueOnce({ id: 12, filename: 'report.pdf' })
      .mockResolvedValueOnce(null);
    indexedFiles.scanFolder.mockResolvedValue({
      status: 'done',
      added: 0,
      updated: 0,
      removed: 0,
    });

    await expect(service.executeReady()).resolves.toBe(1);

    expect(indexedFiles.deleteByFilename).toHaveBeenCalledWith(
      { ownerType: 'agent', ownerId: 42 },
      'report.pdf',
    );
    expect(attempts.receiveResult).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          output: {
            kind: ExecutionStepKind.TOOL,
            toolResult: expect.objectContaining({
              status: 'succeeded',
              effects: [expect.objectContaining({ status: 'applied' })],
            }),
          },
        }),
      }),
    );
  });
});

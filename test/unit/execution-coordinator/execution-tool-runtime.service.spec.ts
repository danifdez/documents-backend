import { ExecutionToolRuntimeService } from '../../../src/execution-coordinator/execution-tool-runtime.service';
import { ExecutionStepKind } from '../../../src/execution/execution-step-kind.enum';

const EXECUTION_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca701';
const STEP_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca702';
const OPERATION_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca703';
const ATTEMPT_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca704';
const TOOL_CALL_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca705';

describe('ExecutionToolRuntimeService', () => {
  let attempts: Record<string, jest.Mock>;
  let contracts: Record<string, jest.Mock>;
  let search: Record<string, jest.Mock>;
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
            resourceKey: 'workspace:default:documents',
            mode: 'shared',
          },
        ],
        effects: [],
        policyDecision: { decision: 'allowed', rule: 'workspace_read' },
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
    service = new ExecutionToolRuntimeService(
      attempts as any,
      contracts as any,
      search as any,
    );
  });

  it('executes a prepared search through attempt and receipt boundaries', async () => {
    await expect(service.executeReady()).resolves.toBe(1);

    expect(attempts.claimReadyStep).toHaveBeenCalledWith({
      workerId: '00000000-0000-4000-8000-000000000001',
      stepKinds: [ExecutionStepKind.TOOL],
      capabilities: ['tool.documents.search/1'],
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
});

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
    };
    executionRepo = {
      findOne: jest.fn().mockResolvedValue(execution),
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
    service = new ExecutionToolPlanService(
      {
        transaction: jest.fn(async (callback) => callback(manager)),
      } as any,
      {
        assertToolInvocation: jest.fn(),
        assertToolPlan: jest.fn(),
      } as any,
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
});

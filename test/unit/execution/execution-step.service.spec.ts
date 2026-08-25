import { BadRequestException } from '@nestjs/common';
import { ExecutionStepDependencyEntity } from '../../../src/execution/execution-step-dependency.entity';
import { ExecutionStepKind } from '../../../src/execution/execution-step-kind.enum';
import { ExecutionStepStatus } from '../../../src/execution/execution-step-status.enum';
import { ExecutionStepEntity } from '../../../src/execution/execution-step.entity';
import { ExecutionStepService } from '../../../src/execution/execution-step.service';
import { ExecutionEntity } from '../../../src/execution/execution.entity';
import { ExecutionEventEntity } from '../../../src/execution/execution-event.entity';
import { ExecutionOperationEntity } from '../../../src/execution/execution-operation.entity';
import { ExecutionOperationStatus } from '../../../src/execution/execution-operation-status.enum';

const EXECUTION_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca701';
const STEP_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca702';
const DEPENDENCY_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca703';
const SECOND_DEPENDENCY_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca704';
const EVENT_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca705';

describe('ExecutionStepService', () => {
  let service: ExecutionStepService;
  let executionRepo: Record<string, jest.Mock>;
  let stepRepo: Record<string, jest.Mock>;
  let dependencyRepo: Record<string, jest.Mock>;
  let eventRepo: Record<string, jest.Mock>;
  let operationRepo: Record<string, jest.Mock>;
  let manager: Record<string, jest.Mock>;

  beforeEach(() => {
    executionRepo = {
      findOne: jest.fn().mockResolvedValue({
        executionId: EXECUTION_ID,
        rootExecutionId: EXECUTION_ID,
        lastEventId: EVENT_ID,
      }),
    };
    stepRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOneBy: jest.fn(),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    dependencyRepo = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
      findOneBy: jest.fn().mockResolvedValue(null),
    };
    eventRepo = {
      findOneBy: jest.fn().mockResolvedValue({ eventId: EVENT_ID }),
    };
    operationRepo = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
      findOneBy: jest.fn().mockImplementation(async ({ operationId }) => ({
        operationId,
        status: ExecutionOperationStatus.PLANNED,
      })),
    };
    manager = {
      getRepository: jest.fn((entity) => {
        if (entity === ExecutionEntity) return executionRepo;
        if (entity === ExecutionStepEntity) return stepRepo;
        if (entity === ExecutionStepDependencyEntity) return dependencyRepo;
        if (entity === ExecutionEventEntity) return eventRepo;
        if (entity === ExecutionOperationEntity) return operationRepo;
        throw new Error(`Unexpected repository ${entity.name}`);
      }),
      query: jest.fn().mockResolvedValue([]),
    };
    service = new ExecutionStepService({
      transaction: jest.fn(async (callback) => callback(manager)),
    } as any);
  });

  it('creates a ready step atomically when it has no dependencies', async () => {
    const step = await service.createStep({
      executionId: EXECUTION_ID,
      stepId: STEP_ID,
      stepKind: ExecutionStepKind.SERVICE,
      work: { taskType: 'detect-language' },
      requiredCapabilities: [],
    });

    expect(step).toEqual(
      expect.objectContaining({
        stepId: STEP_ID,
        executionId: EXECUTION_ID,
        schemaVersion: 'step/1',
        status: ExecutionStepStatus.READY,
        finalizeOnFailure: false,
      }),
    );
    expect(stepRepo.save).toHaveBeenCalledTimes(1);
    expect(operationRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: step.operationId,
        causedByEventId: EVENT_ID,
        status: ExecutionOperationStatus.PREPARED,
      }),
    );
    expect(dependencyRepo.save).not.toHaveBeenCalled();
  });

  it('creates a blocked step while a dependency is incomplete', async () => {
    stepRepo.find.mockResolvedValue([
      {
        stepId: DEPENDENCY_ID,
        executionId: EXECUTION_ID,
        status: ExecutionStepStatus.RUNNING,
      },
    ]);

    const step = await service.createStep({
      executionId: EXECUTION_ID,
      stepId: STEP_ID,
      stepKind: ExecutionStepKind.SERVICE,
      dependsOnStepIds: [DEPENDENCY_ID],
      work: { taskType: 'detect-language' },
    });

    expect(step.status).toBe(ExecutionStepStatus.BLOCKED);
    expect(operationRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: ExecutionOperationStatus.PLANNED }),
    );
    expect(dependencyRepo.save).toHaveBeenCalledWith([
      { stepId: STEP_ID, dependsOnStepId: DEPENDENCY_ID },
    ]);
  });

  it('rejects dependencies from another execution', async () => {
    stepRepo.find.mockResolvedValue([
      {
        stepId: DEPENDENCY_ID,
        executionId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca799',
        status: ExecutionStepStatus.COMPLETED,
      },
    ]);

    await expect(
      service.createStep({
        executionId: EXECUTION_ID,
        stepId: STEP_ID,
        stepKind: ExecutionStepKind.SERVICE,
        dependsOnStepIds: [DEPENDENCY_ID],
        work: { taskType: 'detect-language' },
      }),
    ).rejects.toThrow('invalid_step_dependency');
    expect(stepRepo.save).not.toHaveBeenCalled();
  });

  it('rejects a dependency that would close a cycle', async () => {
    stepRepo.find.mockResolvedValue([
      {
        stepId: STEP_ID,
        executionId: EXECUTION_ID,
        status: ExecutionStepStatus.READY,
      },
      {
        stepId: DEPENDENCY_ID,
        executionId: EXECUTION_ID,
        status: ExecutionStepStatus.READY,
      },
    ]);
    manager.query.mockResolvedValue([{ found: 1 }]);

    await expect(service.addDependency(STEP_ID, DEPENDENCY_ID)).rejects.toThrow(
      BadRequestException,
    );
    expect(dependencyRepo.save).not.toHaveBeenCalled();
  });

  it('releases every blocked dependent whose requirements completed', async () => {
    manager.query.mockResolvedValue([{ step_id: STEP_ID }]);
    stepRepo.findOneBy.mockResolvedValue({
      stepId: STEP_ID,
      operationId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca706',
      status: ExecutionStepStatus.BLOCKED,
      version: 1,
      work: { taskType: 'next-step' },
    });

    await expect(service.releaseDependents(DEPENDENCY_ID)).resolves.toBe(1);
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('required_step."status" <> \'completed\''),
      [DEPENDENCY_ID],
    );
    expect(stepRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: ExecutionStepStatus.READY,
        version: 2,
      }),
    );
  });

  it('materializes map results in declared order before releasing reduce', async () => {
    const reduce = {
      stepId: STEP_ID,
      operationId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca706',
      status: ExecutionStepStatus.BLOCKED,
      version: 1,
      work: {
        taskType: 'summarize-reduce',
        payload: { targetLanguage: 'en' },
        coordination: {
          kind: 'map-reduce-reduce/1',
          mapStepIds: [DEPENDENCY_ID, SECOND_DEPENDENCY_ID],
          resultKey: 'response',
        },
      },
    };
    manager.query.mockResolvedValue([{ step_id: STEP_ID }]);
    stepRepo.findOneBy.mockResolvedValue(reduce);
    stepRepo.find.mockResolvedValue([
      {
        stepId: SECOND_DEPENDENCY_ID,
        status: ExecutionStepStatus.COMPLETED,
        result: {
          kind: 'inference',
          outcome: {
            kind: 'structured_result',
            value: { response: 'second' },
          },
        },
      },
      {
        stepId: DEPENDENCY_ID,
        status: ExecutionStepStatus.COMPLETED,
        result: {
          kind: 'inference',
          outcome: {
            kind: 'structured_result',
            value: { response: 'first' },
          },
        },
      },
    ]);

    await expect(service.releaseDependents(DEPENDENCY_ID)).resolves.toBe(1);
    expect(reduce.work.payload).toEqual({
      targetLanguage: 'en',
      partials: ['first', 'second'],
    });
    expect(reduce.status).toBe(ExecutionStepStatus.READY);
  });

  it('materializes structured map results for deterministic reduce steps', async () => {
    const reduce = {
      stepId: STEP_ID,
      operationId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca706',
      status: ExecutionStepStatus.BLOCKED,
      version: 1,
      work: {
        taskType: 'entity-extraction-reduce',
        payload: {},
        coordination: {
          kind: 'map-reduce-reduce/1',
          mapStepIds: [DEPENDENCY_ID, SECOND_DEPENDENCY_ID],
          resultKey: 'entities',
        },
      },
    };
    manager.query.mockResolvedValue([{ step_id: STEP_ID }]);
    stepRepo.findOneBy.mockResolvedValue(reduce);
    stepRepo.find.mockResolvedValue([
      {
        stepId: DEPENDENCY_ID,
        status: ExecutionStepStatus.COMPLETED,
        result: {
          kind: 'inference',
          outcome: {
            kind: 'structured_result',
            value: { entities: [{ word: 'Ada', entity: 'PERSON' }] },
          },
        },
      },
      {
        stepId: SECOND_DEPENDENCY_ID,
        status: ExecutionStepStatus.COMPLETED,
        result: {
          kind: 'inference',
          outcome: {
            kind: 'structured_result',
            value: { entities: [{ word: 'Paris', entity: 'GPE' }] },
          },
        },
      },
    ]);

    await expect(service.releaseDependents(DEPENDENCY_ID)).resolves.toBe(1);
    expect(reduce.work.payload).toEqual({
      partials: [
        [{ word: 'Ada', entity: 'PERSON' }],
        [{ word: 'Paris', entity: 'GPE' }],
      ],
    });
  });
});

import { BadRequestException } from '@nestjs/common';
import { ExecutionStepDependencyEntity } from '../../../src/execution/execution-step-dependency.entity';
import { ExecutionStepKind } from '../../../src/execution/execution-step-kind.enum';
import { ExecutionStepStatus } from '../../../src/execution/execution-step-status.enum';
import { ExecutionStepEntity } from '../../../src/execution/execution-step.entity';
import { ExecutionStepService } from '../../../src/execution/execution-step.service';
import { ExecutionEntity } from '../../../src/execution/execution.entity';

const EXECUTION_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca701';
const STEP_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca702';
const DEPENDENCY_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca703';

describe('ExecutionStepService', () => {
  let service: ExecutionStepService;
  let executionRepo: Record<string, jest.Mock>;
  let stepRepo: Record<string, jest.Mock>;
  let dependencyRepo: Record<string, jest.Mock>;
  let manager: Record<string, jest.Mock>;

  beforeEach(() => {
    executionRepo = {
      findOne: jest.fn().mockResolvedValue({ executionId: EXECUTION_ID }),
    };
    stepRepo = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    dependencyRepo = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
      findOneBy: jest.fn().mockResolvedValue(null),
    };
    manager = {
      getRepository: jest.fn((entity) => {
        if (entity === ExecutionEntity) return executionRepo;
        if (entity === ExecutionStepEntity) return stepRepo;
        if (entity === ExecutionStepDependencyEntity) return dependencyRepo;
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
      }),
    );
    expect(stepRepo.save).toHaveBeenCalledTimes(1);
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

    await expect(service.releaseDependents(DEPENDENCY_ID)).resolves.toBe(1);
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('required_step."status" <> \'completed\''),
      [DEPENDENCY_ID],
    );
  });
});

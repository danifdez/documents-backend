import { DataSource } from 'typeorm';
import { canonicalHash } from '../../../src/execution/execution-canonical';
import { ExecutionConfirmationEntity } from '../../../src/execution/execution-confirmation.entity';
import { ExecutionConfirmationService } from '../../../src/execution/execution-confirmation.service';
import { ExecutionContractValidator } from '../../../src/execution/execution-contract-validator';
import { ExecutionEntity } from '../../../src/execution/execution.entity';
import { ExecutionStatus } from '../../../src/execution/execution-status.enum';
import { ExecutionToolPlanEntity } from '../../../src/execution/execution-tool-plan.entity';

describe('ExecutionConfirmationService decision fencing', () => {
  const owner = { ownerPrincipal: '7' };
  const confirmationId = 'confirmation';
  const plan = {
    confirmationRequirement: {
      confirmationId,
      reason: 'Write file',
      prompt: 'Create?',
      scope: 'once',
    },
    resources: [],
    effects: [],
  };

  function fixture(
    status: ExecutionStatus,
    cancellationRequestedAt: Date | null,
    decided = false,
  ) {
    const execution = {
      executionId: 'root',
      rootExecutionId: 'root',
      ...owner,
      status,
      waitReason: 'confirmation',
      cancellationRequestedAt,
    };
    const confirmation = {
      confirmationId,
      ...owner,
      executionId: 'root',
      operationId: 'operation',
      status: decided ? 'approved' : 'pending',
      requestedAt: new Date(),
      planHash: canonicalHash(plan),
    };
    const confirmationSave = jest.fn();
    const executionFind = jest.fn().mockResolvedValue(execution);
    const repositories = new Map<unknown, unknown>([
      [
        ExecutionEntity,
        {
          findOneBy: jest.fn().mockResolvedValue(execution),
          findOne: executionFind,
        },
      ],
      [
        ExecutionConfirmationEntity,
        {
          findOneBy: jest.fn().mockResolvedValue(confirmation),
          findOne: jest.fn().mockResolvedValue(confirmation),
          save: confirmationSave,
        },
      ],
      [
        ExecutionToolPlanEntity,
        {
          findOneBy: jest
            .fn()
            .mockResolvedValue({ plan, toolName: 'workspace_files.write' }),
          findOne: jest
            .fn()
            .mockResolvedValue({ plan, toolName: 'workspace_files.write' }),
        },
      ],
    ]);
    const manager = {
      getRepository: (entity: unknown) => repositories.get(entity),
    };
    const dataSource = {
      ...manager,
      transaction: (callback: (value: typeof manager) => unknown) =>
        callback(manager),
    };
    const service = new ExecutionConfirmationService(
      dataSource as unknown as DataSource,
      {} as ExecutionContractValidator,
    );
    return { service, confirmationSave, executionFind };
  }

  it.each([
    [ExecutionStatus.WAITING, new Date()],
    [ExecutionStatus.CANCELLED, null],
  ])(
    'rejects a pending approval while the execution is %s',
    async (status, cancellationRequestedAt) => {
      const { service, confirmationSave, executionFind } = fixture(
        status,
        cancellationRequestedAt,
      );
      await expect(
        service.decide(confirmationId, 'approved', owner),
      ).rejects.toThrow('confirmation_inactive');
      await expect(service.read(confirmationId, owner)).rejects.toThrow(
        'confirmation_inactive',
      );
      expect(executionFind).toHaveBeenCalledWith({
        where: { executionId: 'root' },
        lock: { mode: 'pessimistic_write' },
      });
      expect(confirmationSave).not.toHaveBeenCalled();
    },
  );

  it('returns an already accepted decision without reopening the execution', async () => {
    const { service, confirmationSave } = fixture(
      ExecutionStatus.COMPLETED,
      null,
      true,
    );
    await expect(
      service.decide(confirmationId, 'approved', owner),
    ).resolves.toMatchObject({
      confirmationId,
      status: 'approved',
      planHash: canonicalHash(plan),
    });
    await expect(service.read(confirmationId, owner)).resolves.toMatchObject({
      confirmation: { confirmationId, status: 'approved' },
    });
    expect(confirmationSave).not.toHaveBeenCalled();
  });
});

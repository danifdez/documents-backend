import { ConflictException, NotFoundException } from '@nestjs/common';
import { ExecutionService } from '../../../src/execution/execution.service';
import { ExecutionEntity } from '../../../src/execution/execution.entity';
import { ExecutionRequestEntity } from '../../../src/execution/execution-request.entity';
import { ExecutionPriority } from '../../../src/execution/execution-priority.enum';
import { createExecutionStep } from '../../../src/execution/execution-step.service';

jest.mock('../../../src/execution/execution-step.service', () => ({
  createExecutionStep: jest.fn().mockResolvedValue({}),
}));

describe('Durable owned execution request acceptance', () => {
  const requestId = '11111111-1111-4111-8111-111111111111';
  const scope = { ownerPrincipal: 'user-7' };
  const payload = { requestJson: '{"messages":[]}', label: 'translate' };
  let service: ExecutionService;
  let requests: Map<string, ExecutionRequestEntity>;
  let executions: Map<string, ExecutionEntity>;
  let cancel: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    requests = new Map();
    executions = new Map();
    const key = (v: { ownerPrincipal: string; requestId: string }) =>
      `${v.ownerPrincipal}/${v.requestId}`;
    const matching = (where: Record<string, unknown>) =>
      [...executions.values()].find((row) =>
        Object.entries(where).every(([field, value]) => row[field] === value),
      ) ?? null;
    const requestRepo = {
      createQueryBuilder: () => {
        let value: ExecutionRequestEntity;
        const builder = {
          insert: () => builder,
          values: (input: ExecutionRequestEntity) => {
            value = input;
            return builder;
          },
          orIgnore: () => builder,
          execute: async () => {
            if (!requests.has(key(value))) requests.set(key(value), value);
          },
        };
        return builder;
      },
      findOneBy: async (where: ExecutionRequestEntity) =>
        requests.get(key(where)) ?? null,
      findOneOrFail: async ({ where }) => requests.get(key(where)),
      save: async (row: ExecutionRequestEntity) => {
        requests.set(key(row), row);
        return row;
      },
    };
    const executionRepo = {
      create: (row: ExecutionEntity) => row,
      save: async (row: ExecutionEntity) => {
        executions.set(row.executionId, row);
        return row;
      },
      findOneBy: async (where) => matching(where),
      findOne: async ({ where }) => matching(where),
    };
    const manager = {
      getRepository: (entity) => {
        if (entity === ExecutionRequestEntity) return requestRepo;
        if (entity === ExecutionEntity) return executionRepo;
        throw new Error('Unexpected repository');
      },
    };
    service = Object.create(ExecutionService.prototype);
    Object.assign(service, {
      dataSource: {
        transaction: async (callback) => callback(manager),
        getRepository: manager.getRepository,
      },
      executionRepo,
      appendBackendEvent: jest
        .fn()
        .mockResolvedValue({ sequence: '1', eventId: 'event-1' }),
      reconcileRequestedCancellations: jest.fn().mockResolvedValue(0),
    });
    cancel = jest.fn(async (_manager, executionId) => {
      executions.get(executionId)!.status = 'cancelled' as any;
    });
    Object.assign(service, { requestCancellationInTransaction: cancel });
  });

  const accept = () =>
    service.createInference(
      'browser-inference',
      ExecutionPriority.HIGH,
      payload,
      { ...scope, requestId, finalizeOnFailure: true },
    );

  it('reuses the same durable execution and step after a lost acceptance', async () => {
    const first = await accept();
    expect((await accept()).executionId).toBe(first.executionId);
    expect(executions.size).toBe(1);
    expect(createExecutionStep).toHaveBeenCalledTimes(1);
    expect(await service.readRequest(requestId, scope)).toMatchObject({
      requestId,
      executionId: first.executionId,
    });
  });

  it('rejects changed input, preserving the original acceptance', async () => {
    await accept();
    await expect(
      service.createInference(
        'browser-inference',
        ExecutionPriority.HIGH,
        { ...payload, requestJson: '{"messages":[1]}' },
        { ...scope, requestId, finalizeOnFailure: true },
      ),
    ).rejects.toThrow(ConflictException);
    expect(createExecutionStep).toHaveBeenCalledTimes(1);
  });

  it('persists cancellation before acceptance without creating execution work', async () => {
    expect(await service.cancelRequest(requestId, scope)).toMatchObject({
      executionId: null,
      status: 'cancelled',
      cancelRequested: true,
    });
    await expect(accept()).rejects.toThrow('execution_request_cancelled');
    expect(executions.size).toBe(0);
    expect(createExecutionStep).not.toHaveBeenCalled();
  });

  it('uses the existing cancellation transition for an accepted execution', async () => {
    const first = await accept();
    await service.cancelRequest(requestId, scope);
    await service.cancelRequest(requestId, scope);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel.mock.calls[0][1]).toBe(first.executionId);
    expect((await accept()).status).toBe('cancelled');
    expect(createExecutionStep).toHaveBeenCalledTimes(1);
  });

  it('does not recreate a bound execution after evidence retention', async () => {
    const first = await accept();
    executions.delete(first.executionId);
    await expect(accept()).rejects.toThrow('execution_request_unavailable');
    expect(createExecutionStep).toHaveBeenCalledTimes(1);
  });

  it('isolates lookups and cancellation identities between users', async () => {
    const first = await accept();
    const other = { ownerPrincipal: 'user-8' };
    await expect(service.readRequest(requestId, other)).rejects.toThrow(
      NotFoundException,
    );
    expect(await service.cancelRequest(requestId, other)).toMatchObject({
      executionId: null,
    });
    expect(executions.get(first.executionId)!.status).toBe('queued');
    expect(cancel).not.toHaveBeenCalled();
  });

  it('rejects invalid identities before opening a receipt', async () => {
    await expect(service.cancelRequest('../other', scope)).rejects.toThrow(
      'Invalid execution request identity',
    );
    expect(requests.size).toBe(0);
  });
});

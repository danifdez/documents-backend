import { EntityManager } from 'typeorm';
import { ExecutionEventEntity } from '../../../src/execution/execution-event.entity';
import { ExecutionEntity } from '../../../src/execution/execution.entity';
import { appendBackendExecutionEvent } from '../../../src/execution/execution-event.writer';

function managerMock(): {
  manager: EntityManager;
  saved: () => ExecutionEventEntity;
} {
  let saved: ExecutionEventEntity;
  const manager = {
    getRepository: () => ({
      create: (value: Record<string, unknown>) => value,
    }),
    save: (row: ExecutionEventEntity) => {
      saved = row;
      return Promise.resolve(row);
    },
  } as unknown as EntityManager;
  return { manager, saved: () => saved };
}

describe('appendBackendExecutionEvent', () => {
  it('records an inference result with scores without breaking the profile', async () => {
    const { manager, saved } = managerMock();
    const execution = {
      executionId: '00000000-0000-4000-8000-000000000001',
      rootExecutionId: '00000000-0000-4000-8000-000000000001',
      lastSequence: '0',
    } as ExecutionEntity;

    await expect(
      appendBackendExecutionEvent(manager, execution, 1, {
        eventType: 'operation.finished',
        payloadSchema: 'operation.finished/1',
        payload: {
          operationKind: 'inference',
          status: 'succeeded',
          outcome: 'structured_result',
          result: {
            results: [{ text: 'uno', score: 0.883236437798016 }],
          },
          error: null,
        },
        actor: { type: 'system' },
        executionId: execution.executionId,
      }),
    ).resolves.toBeDefined();

    const envelope = saved().envelope as Record<string, unknown>;
    expect(envelope.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect((envelope.payload as Record<string, unknown>).result).toEqual({
      results: [{ text: 'uno', score: '0.883236437798016' }],
    });
  });
});

import { ExecutionService } from '../../../src/execution/execution.service';
import { ExecutionPriority } from '../../../src/execution/execution-priority.enum';
import * as steps from '../../../src/execution/execution-step.service';

describe('Execution capture options', () => {
  afterEach(() => jest.restoreAllMocks());
  function setup() {
    const service = Object.create(ExecutionService.prototype) as any;
    const repository = {
      create: (value) => value,
      save: jest.fn(async (value) => value),
    };
    service.dataSource = {
      transaction: jest.fn((callback) =>
        callback({ getRepository: () => repository }),
      ),
    };
    service.appendBackendEvent = jest
      .fn()
      .mockResolvedValue({ sequence: '1', eventId: 'created' });
    const createStep = jest
      .spyOn(steps, 'createExecutionStep')
      .mockResolvedValue({} as any);
    return { service, createStep };
  }
  it.each(['ask', 'translate', 'future-operation'])(
    'authorizes inference steps of %s through the shared creation path',
    async (taskType) => {
      const { service, createStep } = setup();
      const payload = { source: 'controlled' };
      await service.create(taskType, ExecutionPriority.NORMAL, payload, {
        ownerPrincipal: '7',
        captureInference: true,
        steps: ['inference', 'code', 'inference'].map((stepKind) => ({
          stepKind,
          work: { taskType: 'any-handler', payload: {} },
        })),
      });
      const created = createStep.mock.calls.map(([, input]) => input);
      for (const input of created.filter(
        (value) => value.stepKind === 'inference',
      )) {
        expect(input.work.inferenceCapture).toEqual({
          schemaVersion: 'inference-capture/1',
          purpose: 'evaluation',
          authorizedBy: '7',
        });
      }
      expect(created[1].work).not.toHaveProperty('inferenceCapture');
      expect(payload).toEqual({ source: 'controlled' });
    },
  );
  it('does not enable capture without an explicit execution option', async () => {
    const { service, createStep } = setup();
    await service.create(
      'anything',
      ExecutionPriority.NORMAL,
      {},
      {
        ownerPrincipal: '7',
        steps: [
          {
            stepKind: 'inference',
            work: { taskType: 'any-handler', payload: {} },
          },
        ],
      },
    );
    expect(createStep.mock.calls[0][1].work).not.toHaveProperty(
      'inferenceCapture',
    );
  });
  it.each([undefined, 'standalone', 'system'])(
    'rejects unauthenticated capture owner %s before writing',
    async (ownerPrincipal) => {
      const { service } = setup();
      await expect(
        service.create(
          'anything',
          ExecutionPriority.NORMAL,
          {},
          { ownerPrincipal, captureInference: true },
        ),
      ).rejects.toThrow('authenticated owner');
      expect(service.dataSource.transaction).not.toHaveBeenCalled();
    },
  );
});

import { ExecutionController } from '../../../src/execution/execution.controller';

describe('ExecutionController', () => {
  const service = {
    resolveAccessScope: jest.fn(() => ({
      ownerPrincipal: 'user-1',
    })),
    readEvents: jest.fn(),
    readProgress: jest.fn(),
    exportBundle: jest.fn(),
  };
  const controller = new ExecutionController(service as any);

  beforeEach(() => jest.clearAllMocks());

  it('derives scope and forwards explicit evaluation consent', async () => {
    service.exportBundle.mockResolvedValue({
      bundleSchema: 'execution-bundle/1',
    });

    await controller.bundle('run-1', { userId: 7 }, 'granted');

    expect(service.resolveAccessScope).toHaveBeenCalledWith({ userId: 7 });
    expect(service.exportBundle).toHaveBeenCalledWith(
      'run-1',
      {
        ownerPrincipal: 'user-1',
      },
      true,
    );
  });

  it('does not infer evaluation consent when the header is absent', async () => {
    await controller.bundle('run-1', { userId: 7 }, undefined);

    expect(service.exportBundle).toHaveBeenCalledWith(
      'run-1',
      {
        ownerPrincipal: 'user-1',
      },
      false,
    );
  });

  it('uses the same access scope for the materialized progress projection', async () => {
    service.readProgress.mockResolvedValue({ policy: null, ledger: null });

    await controller.progress('run-1', { userId: 7 });

    expect(service.readProgress).toHaveBeenCalledWith('run-1', {
      ownerPrincipal: 'user-1',
    });
  });
});

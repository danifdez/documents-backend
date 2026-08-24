import { ExecutionController } from '../../../src/execution/execution.controller';

describe('ExecutionController', () => {
  const service = {
    resolveAccessScope: jest.fn(() => ({
      ownerPrincipal: 'user-1',
      workspaceId: 'workspace-1',
    })),
    readEvents: jest.fn(),
    readProgress: jest.fn(),
    exportBundle: jest.fn(),
  };
  const controller = new ExecutionController(service as any);

  beforeEach(() => jest.clearAllMocks());

  it('derives the read scope from the authenticated principal and workspace header', async () => {
    service.exportBundle.mockResolvedValue({
      bundleSchema: 'execution-bundle/1',
    });

    await controller.bundle('run-1', { userId: 7 }, 'workspace-1');

    expect(service.resolveAccessScope).toHaveBeenCalledWith(
      { userId: 7 },
      'workspace-1',
    );
    expect(service.exportBundle).toHaveBeenCalledWith('run-1', {
      ownerPrincipal: 'user-1',
      workspaceId: 'workspace-1',
    });
  });

  it('uses the same access scope for the materialized progress projection', async () => {
    service.readProgress.mockResolvedValue({ policy: null, ledger: null });

    await controller.progress('run-1', { userId: 7 }, 'workspace-1');

    expect(service.readProgress).toHaveBeenCalledWith('run-1', {
      ownerPrincipal: 'user-1',
      workspaceId: 'workspace-1',
    });
  });
});

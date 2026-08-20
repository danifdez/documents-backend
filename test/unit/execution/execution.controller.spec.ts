import { UnauthorizedException } from '@nestjs/common';
import { ExecutionController } from '../../../src/execution/execution.controller';

describe('ExecutionController', () => {
  const service = {
    acceptArtifacts: jest.fn(),
    acceptEvents: jest.fn(),
    resolveAccessScope: jest.fn(() => ({
      ownerPrincipal: 'user-1',
      workspaceId: 'workspace-1',
    })),
    readEvents: jest.fn(),
    readProgress: jest.fn(),
    exportBundle: jest.fn(),
  };
  const config = { get: jest.fn(() => 'internal-secret') };
  const controller = new ExecutionController(service as any, config as any);

  beforeEach(() => jest.clearAllMocks());

  it('rejects absent and incorrect internal ingestion tokens', async () => {
    await expect(
      controller.ingestEvents('run-1', undefined, { events: [] }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      controller.ingestEvents('run-1', 'wrong', { events: [] }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(service.acceptEvents).not.toHaveBeenCalled();
  });

  it('accepts the configured internal token without exposing it to the service', async () => {
    service.acceptEvents.mockResolvedValue({ accepted: 1, duplicates: 0 });
    const events = [{ eventId: 'event-1' }];

    await expect(
      controller.ingestEvents('run-1', 'internal-secret', { events }),
    ).resolves.toEqual({ accepted: 1, duplicates: 0 });
    expect(config.get).toHaveBeenCalledWith('EXECUTION_INGEST_TOKEN');
    expect(service.acceptEvents).toHaveBeenCalledWith('run-1', events);
  });

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

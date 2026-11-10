import {
  ExecutionContext,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AgentOwnedGuard,
  AssistantOwnedGuard,
} from '../../../../src/auth/guards/owned-resource.guard';

function context(
  params: Record<string, string>,
  user?: unknown,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ params, user }),
    }),
  } as any;
}

function config(authEnabled: boolean) {
  return { get: jest.fn(() => (authEnabled ? 'true' : 'false')) };
}

describe('OwnedResourceGuard', () => {
  it('allows requests when auth is disabled', async () => {
    const guard = new AssistantOwnedGuard({} as any, config(false) as any);
    await expect(
      guard.canActivate(context({ assistantId: '1' })),
    ).resolves.toBe(true);
  });

  it('fails closed when auth is enabled and there is no user', async () => {
    const guard = new AssistantOwnedGuard({} as any, config(true) as any);
    await expect(
      guard.canActivate(context({ assistantId: '1' })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an assistant owned by another principal', async () => {
    const repo = { exist: jest.fn().mockResolvedValue(false) };
    const guard = new AssistantOwnedGuard(repo as any, config(true) as any);

    await expect(
      guard.canActivate(context({ assistantId: '1' }, { userId: 'user-a' })),
    ).rejects.toThrow(NotFoundException);
    expect(repo.exist).toHaveBeenCalledWith({
      where: { id: 1, ownerPrincipal: 'user-a' },
    });
  });

  it('accepts the owner and supports the memory ownerId parameter', async () => {
    const repo = { exist: jest.fn().mockResolvedValue(true) };
    const guard = new AgentOwnedGuard(repo as any, config(true) as any);

    await expect(
      guard.canActivate(context({ ownerId: '2' }, { sub: 'user-b' })),
    ).resolves.toBe(true);
    expect(repo.exist).toHaveBeenCalledWith({
      where: { id: 2, ownerPrincipal: 'user-b' },
    });
  });
});

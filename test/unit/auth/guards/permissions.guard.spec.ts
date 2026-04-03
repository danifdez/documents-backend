import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../../../../src/auth/guards/permissions.guard';

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let configService: { get: jest.Mock };

  const mockContext = (user?: any): ExecutionContext => ({
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any);

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    configService = { get: jest.fn() };
    guard = new PermissionsGuard(reflector as any, configService as any);
  });

  it('should allow if auth is disabled', () => {
    configService.get.mockReturnValue('false');
    expect(guard.canActivate(mockContext())).toBe(true);
  });

  it('should allow if no permissions required', () => {
    configService.get.mockReturnValue('true');
    reflector.getAllAndOverride.mockReturnValue(null);
    expect(guard.canActivate(mockContext())).toBe(true);
  });

  it('should allow if user has required permissions', () => {
    configService.get.mockReturnValue('true');
    reflector.getAllAndOverride.mockReturnValue(['upload']);
    expect(guard.canActivate(mockContext({ permissions: { upload: true } }))).toBe(true);
  });

  it('should throw ForbiddenException if user lacks permissions', () => {
    configService.get.mockReturnValue('true');
    reflector.getAllAndOverride.mockReturnValue(['upload']);
    expect(() => guard.canActivate(mockContext({ permissions: {} }))).toThrow(ForbiddenException);
  });
});

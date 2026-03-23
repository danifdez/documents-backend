import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { RolesGuard } from '../../../../src/auth/guards/roles.guard';

describe('RolesGuard', () => {
  let guard: RolesGuard;
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
    guard = new RolesGuard(reflector as any, configService as any);
  });

  it('should allow if auth is disabled', () => {
    configService.get.mockReturnValue('false');
    expect(guard.canActivate(mockContext())).toBe(true);
  });

  it('should allow if no roles required', () => {
    configService.get.mockReturnValue('true');
    reflector.getAllAndOverride.mockReturnValue(null);
    expect(guard.canActivate(mockContext())).toBe(true);
  });

  it('should allow if user has required role', () => {
    configService.get.mockReturnValue('true');
    reflector.getAllAndOverride.mockReturnValue(['admin']);
    expect(guard.canActivate(mockContext({ role: 'admin' }))).toBe(true);
  });

  it('should throw ForbiddenException if user lacks role', () => {
    configService.get.mockReturnValue('true');
    reflector.getAllAndOverride.mockReturnValue(['admin']);
    expect(() => guard.canActivate(mockContext({ role: 'user' }))).toThrow(ForbiddenException);
  });
});

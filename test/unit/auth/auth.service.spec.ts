import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../../../src/auth/auth.service';
import { UserEntity } from '../../../src/auth/user.entity';
import { createMockRepository, MockRepository, mockConfigService } from '../../test-utils';
import { buildUser } from '../../factories';

jest.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;
  let repo: MockRepository<UserEntity>;
  let jwtService: Record<string, jest.Mock>;

  beforeEach(async () => {
    repo = createMockRepository<UserEntity>();
    jwtService = { sign: jest.fn().mockReturnValue('token'), verify: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(UserEntity), useValue: repo },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  describe('validateUser', () => {
    it('should return user if credentials are valid', async () => {
      const user = buildUser({ active: true });
      repo.findOneBy.mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.validateUser('testuser', 'password');
      expect(result).toEqual(user);
    });

    it('should return null if user not found', async () => {
      repo.findOneBy.mockResolvedValue(null);
      expect(await service.validateUser('x', 'y')).toBeNull();
    });

    it('should return null if password is wrong', async () => {
      repo.findOneBy.mockResolvedValue(buildUser());
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      expect(await service.validateUser('testuser', 'wrong')).toBeNull();
    });

    it('should return null if user is inactive', async () => {
      repo.findOneBy.mockResolvedValue(buildUser({ active: false }));
      expect(await service.validateUser('testuser', 'pw')).toBeNull();
    });
  });

  describe('login', () => {
    it('should return access and refresh tokens', async () => {
      const user = buildUser();
      const result = await service.login(user);
      expect(result.accessToken).toBe('token');
      expect(result.refreshToken).toBe('token');
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(jwtService.sign).toHaveBeenCalledTimes(2);
    });
  });

  describe('refreshToken', () => {
    it('should return new tokens for valid refresh token', async () => {
      jwtService.verify.mockReturnValue({ sub: 1, type: 'refresh' });
      repo.findOneBy.mockResolvedValue(buildUser());
      const result = await service.refreshToken('valid-token');
      expect(result.accessToken).toBe('token');
    });

    it('should throw for non-refresh token type', async () => {
      jwtService.verify.mockReturnValue({ sub: 1, type: 'access' });
      await expect(service.refreshToken('bad')).rejects.toThrow(UnauthorizedException);
    });

    it('should throw for inactive user', async () => {
      jwtService.verify.mockReturnValue({ sub: 1, type: 'refresh' });
      repo.findOneBy.mockResolvedValue(null);
      await expect(service.refreshToken('tok')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('createUser', () => {
    it('should hash password and create user', async () => {
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed');
      const user = buildUser();
      repo.create.mockReturnValue(user);
      repo.save.mockResolvedValue(user);

      const result = await service.createUser({ username: 'new', password: 'pw' });
      expect(result).not.toHaveProperty('passwordHash');
    });
  });

  describe('deleteUser', () => {
    it('should soft-delete by setting active to false', async () => {
      const user = buildUser();
      repo.findOneBy.mockResolvedValue(user);
      repo.save.mockResolvedValue({ ...user, active: false });

      const result = await service.deleteUser(1);
      expect(result).toBe(true);
    });

    it('should return false if user not found', async () => {
      repo.findOneBy.mockResolvedValue(null);
      expect(await service.deleteUser(999)).toBe(false);
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../../../src/auth/auth.service';
import { UserEntity } from '../../../src/auth/user.entity';
import { PermissionGroupEntity } from '../../../src/auth/permission-group.entity';
import {
  createMockRepository,
  MockRepository,
  mockConfigService,
} from '../../test-utils';
import { buildUser } from '../../factories';

jest.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;
  let repo: MockRepository<UserEntity>;
  let groupRepo: MockRepository<PermissionGroupEntity>;
  let jwtService: Record<string, jest.Mock>;

  beforeEach(async () => {
    repo = createMockRepository<UserEntity>();
    groupRepo = createMockRepository<PermissionGroupEntity>();
    jwtService = {
      sign: jest.fn().mockReturnValue('token'),
      verify: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(UserEntity), useValue: repo },
        {
          provide: getRepositoryToken(PermissionGroupEntity),
          useValue: groupRepo,
        },
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
      await expect(service.refreshToken('bad')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw for inactive user', async () => {
      jwtService.verify.mockReturnValue({ sub: 1, type: 'refresh' });
      repo.findOneBy.mockResolvedValue(null);
      await expect(service.refreshToken('tok')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('createUser', () => {
    it('should hash password and create user', async () => {
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed');
      const user = buildUser();
      repo.create.mockReturnValue(user);
      repo.save.mockResolvedValue(user);

      const result = await service.createUser({
        username: 'new',
        password: 'pw',
      });
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

  it('reports enabled features only for the configured true value', () => {
    mockConfigService.get
      .mockReturnValueOnce('true')
      .mockReturnValueOnce('true');
    expect(service.isAuthEnabled()).toBe(true);
    expect(service.isOfflineEnabled()).toBe(true);
    expect(service.isAuthEnabled()).toBe(false);
    expect(service.isOfflineEnabled()).toBe(false);
  });

  it('updates users and synchronizes permissions with their selected group', async () => {
    const group = { id: 5, permissions: { read: true } };
    const user = buildUser();
    repo.findOneBy.mockResolvedValue(user);
    repo.save.mockImplementation(async (row) => row);
    groupRepo.findOneBy.mockResolvedValue(group);
    (bcrypt.hash as jest.Mock).mockResolvedValue('updated-hash');

    await expect(
      service.updateUser(1, {
        displayName: 'Member',
        active: false,
        password: 'changed',
        groupId: 5,
        permissions: { write: true },
      }),
    ).resolves.toMatchObject({
      displayName: 'Member',
      active: false,
      groupId: 5,
      permissions: { read: true },
    });
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ passwordHash: 'updated-hash' }),
    );
    expect(user.permissions).not.toBe(group.permissions);

    await expect(
      service.updateUser(1, { groupId: null }),
    ).resolves.toMatchObject({ groupId: null, permissions: { read: true } });
    await expect(
      service.updateUser(1, { groupId: null, permissions: {} }),
    ).resolves.toMatchObject({ permissions: {} });
    await expect(
      service.updateUser(1, { permissions: { upload: true } }),
    ).resolves.toMatchObject({ permissions: { upload: true } });
    groupRepo.findOneBy.mockResolvedValue(null);
    await expect(service.updateUser(1, { groupId: 6 })).resolves.toMatchObject({
      permissions: { upload: true },
    });
    repo.findOneBy.mockResolvedValue(null);
    await expect(service.updateUser(999, {})).resolves.toBeNull();
  });

  it('copies permissions when creating a grouped user and sanitizes all returned users', async () => {
    const group = { id: 5, permissions: { read: true } };
    groupRepo.findOneBy
      .mockResolvedValueOnce(group)
      .mockResolvedValueOnce(null);
    repo.create.mockImplementation((row) => row);
    repo.save.mockImplementation(async (row) => row);
    const first = await service.createUser({
      username: 'member',
      password: 'fixture',
      groupId: 5,
      displayName: '',
    });
    expect(first).toMatchObject({
      displayName: null,
      groupId: 5,
      permissions: { read: true },
    });
    expect(first).not.toHaveProperty('passwordHash');
    expect(first.permissions).not.toBe(group.permissions);
    const second = await service.createUser({
      username: 'other',
      password: 'fixture',
      groupId: 6,
      permissions: { upload: true },
    });
    expect(second.permissions).toEqual({ upload: true });
    repo.find.mockResolvedValue([buildUser(), buildUser({ id: 2 })]);
    expect(await service.findAllUsers()).toHaveLength(2);
    expect(
      (await service.findAllUsers()).every(
        (user) => !Object.prototype.hasOwnProperty.call(user, 'passwordHash'),
      ),
    ).toBe(true);
    expect(repo.find).toHaveBeenCalledWith({ order: { createdAt: 'ASC' } });
    repo.findOneBy.mockResolvedValueOnce(null);
    await expect(service.findUserById(999)).resolves.toBeNull();
  });

  it('requires the current password when changing it and returns a sanitized profile', async () => {
    await expect(service.updateProfile(999, {})).resolves.toBeNull();
    const user = buildUser({ passwordHash: 'previous-hash' });
    repo.findOneBy.mockResolvedValue(user);
    repo.save.mockImplementation(async (row) => row);
    await expect(
      service.updateProfile(1, { newPassword: 'new' }),
    ).rejects.toThrow('Current password is required');
    (bcrypt.compare as jest.Mock)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    await expect(
      service.updateProfile(1, {
        newPassword: 'new',
        currentPassword: 'wrong',
      }),
    ).rejects.toThrow('Current password is incorrect');
    expect(repo.save).not.toHaveBeenCalled();
    (bcrypt.hash as jest.Mock).mockResolvedValue('current-hash');
    const updated = await service.updateProfile(1, {
      newPassword: 'new',
      currentPassword: 'current',
      displayName: 'Updated',
    });
    expect(updated.displayName).toBe('Updated');
    expect(updated).not.toHaveProperty('passwordHash');
    expect(bcrypt.compare).toHaveBeenLastCalledWith('current', 'previous-hash');
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ passwordHash: 'current-hash' }),
    );
    expect(await service.updateProfile(1, {})).toMatchObject({
      displayName: 'Updated',
    });
  });

  it('updates group permissions for assigned users and unassigns them when deleting a group', async () => {
    groupRepo.create.mockImplementation((row) => row);
    groupRepo.save.mockImplementation(async (row) => row);
    await expect(service.createGroup({ name: 'Group' })).resolves.toEqual({
      name: 'Group',
      description: null,
      permissions: {},
    });
    const group = {
      id: 5,
      name: 'Group',
      permissions: { read: true },
      description: 'Old',
    };
    await expect(
      service.updateGroup(999, { name: 'Updated' }),
    ).resolves.toBeNull();
    await expect(service.deleteGroup(999)).resolves.toBe(false);
    groupRepo.findOneBy.mockResolvedValue(group);
    groupRepo.find.mockResolvedValue([group]);
    await expect(service.findGroupById(5)).resolves.toBe(group);
    await expect(service.findAllGroups()).resolves.toEqual([group]);
    expect(groupRepo.find).toHaveBeenCalledWith({ order: { name: 'ASC' } });

    const qb = repo.createQueryBuilder();
    await expect(
      service.updateGroup(5, { name: 'Updated' }),
    ).resolves.toMatchObject({ name: 'Updated', permissions: { read: true } });
    expect(qb.execute).not.toHaveBeenCalled();
    await expect(
      service.updateGroup(5, {
        description: null,
        permissions: { upload: true },
      }),
    ).resolves.toMatchObject({
      description: null,
      permissions: { upload: true },
    });
    expect(qb.where).toHaveBeenCalledWith('group_id = :groupId', {
      groupId: 5,
    });
    expect(qb.set).toHaveBeenCalledWith({ permissions: { upload: true } });
    await expect(service.deleteGroup(5)).resolves.toBe(true);
    expect(qb.set).toHaveBeenLastCalledWith({ groupId: null });
    expect(groupRepo.remove).toHaveBeenCalledWith(group);
  });
});

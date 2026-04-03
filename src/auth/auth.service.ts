import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { UserEntity } from './user.entity';
import { PermissionGroupEntity } from './permission-group.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(PermissionGroupEntity)
    private readonly groupRepo: Repository<PermissionGroupEntity>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  isAuthEnabled(): boolean {
    return this.configService.get('AUTH_ENABLED') === 'true';
  }

  isOfflineEnabled(): boolean {
    return this.configService.get('OFFLINE_ENABLED') === 'true';
  }

  async validateUser(username: string, password: string): Promise<UserEntity | null> {
    const user = await this.userRepo.findOneBy({ username });
    if (!user || !user.active) return null;

    const valid = await bcrypt.compare(password, user.passwordHash);
    return valid ? user : null;
  }

  async login(user: UserEntity) {
    const payload = {
      sub: user.id,
      username: user.username,
      permissions: user.permissions,
    };

    const refreshPayload = { sub: user.id, type: 'refresh' };

    const accessExpiry = this.configService.get('JWT_ACCESS_EXPIRY', '15m');
    const refreshExpiry = this.configService.get('JWT_REFRESH_EXPIRY', '7d');

    return {
      accessToken: this.jwtService.sign(payload, { expiresIn: accessExpiry }),
      refreshToken: this.jwtService.sign(refreshPayload, { expiresIn: refreshExpiry }),
      user: this.sanitizeUser(user),
    };
  }

  async refreshToken(token: string) {
    try {
      const payload = this.jwtService.verify(token);
      if (payload.type !== 'refresh') {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const user = await this.userRepo.findOneBy({ id: payload.sub });
      if (!user || !user.active) {
        throw new UnauthorizedException('User not found or inactive');
      }

      return this.login(user);
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  async createUser(dto: CreateUserDto): Promise<any> {
    const hash = await bcrypt.hash(dto.password, 10);
    let permissions = dto.permissions || {};

    // If a group is assigned, use the group's permissions
    if (dto.groupId) {
      const group = await this.groupRepo.findOneBy({ id: dto.groupId });
      if (group) permissions = { ...group.permissions };
    }

    const user = this.userRepo.create({
      username: dto.username,
      passwordHash: hash,
      displayName: dto.displayName || null,
      permissions,
      groupId: dto.groupId ?? null,
    });
    const saved = await this.userRepo.save(user);
    return this.sanitizeUser(saved);
  }

  async updateUser(id: number, dto: UpdateUserDto): Promise<any> {
    const user = await this.userRepo.findOneBy({ id });
    if (!user) return null;

    if (dto.displayName !== undefined) user.displayName = dto.displayName;
    if (dto.active !== undefined) user.active = dto.active;
    if (dto.password) {
      user.passwordHash = await bcrypt.hash(dto.password, 10);
    }

    // Group assignment: sync permissions from group
    if (dto.groupId !== undefined) {
      user.groupId = dto.groupId;
      if (dto.groupId) {
        const group = await this.groupRepo.findOneBy({ id: dto.groupId });
        if (group) user.permissions = { ...group.permissions };
      } else {
        // Removed from group — use provided permissions or keep current
        if (dto.permissions !== undefined) user.permissions = dto.permissions;
      }
    } else if (dto.permissions !== undefined) {
      user.permissions = dto.permissions;
    }

    const saved = await this.userRepo.save(user);
    return this.sanitizeUser(saved);
  }

  async findAllUsers(): Promise<any[]> {
    const users = await this.userRepo.find({ order: { createdAt: 'ASC' } });
    return users.map((u) => this.sanitizeUser(u));
  }

  async findUserById(id: number): Promise<any | null> {
    const user = await this.userRepo.findOneBy({ id });
    return user ? this.sanitizeUser(user) : null;
  }

  async deleteUser(id: number): Promise<boolean> {
    const user = await this.userRepo.findOneBy({ id });
    if (!user) return false;
    user.active = false;
    await this.userRepo.save(user);
    return true;
  }

  // ── Profile (self-service) ──────────────────────────────────────

  async updateProfile(id: number, dto: UpdateProfileDto): Promise<any> {
    const user = await this.userRepo.findOneBy({ id });
    if (!user) return null;

    if (dto.displayName !== undefined) user.displayName = dto.displayName;

    if (dto.newPassword) {
      if (!dto.currentPassword) {
        throw new UnauthorizedException('Current password is required');
      }
      const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
      if (!valid) {
        throw new UnauthorizedException('Current password is incorrect');
      }
      user.passwordHash = await bcrypt.hash(dto.newPassword, 10);
    }

    const saved = await this.userRepo.save(user);
    return this.sanitizeUser(saved);
  }

  // ── Permission Groups ──────────────────────────────────────────

  async createGroup(dto: CreateGroupDto): Promise<PermissionGroupEntity> {
    const group = this.groupRepo.create({
      name: dto.name,
      description: dto.description || null,
      permissions: dto.permissions || {},
    });
    return this.groupRepo.save(group);
  }

  async updateGroup(id: number, dto: UpdateGroupDto): Promise<PermissionGroupEntity | null> {
    const group = await this.groupRepo.findOneBy({ id });
    if (!group) return null;

    if (dto.name !== undefined) group.name = dto.name;
    if (dto.description !== undefined) group.description = dto.description;
    if (dto.permissions !== undefined) {
      group.permissions = dto.permissions;
      // Sync permissions to all users in this group
      await this.userRepo
        .createQueryBuilder()
        .update(UserEntity)
        .set({ permissions: dto.permissions })
        .where('group_id = :groupId', { groupId: id })
        .execute();
    }

    return this.groupRepo.save(group);
  }

  async findAllGroups(): Promise<PermissionGroupEntity[]> {
    return this.groupRepo.find({ order: { name: 'ASC' } });
  }

  async findGroupById(id: number): Promise<PermissionGroupEntity | null> {
    return this.groupRepo.findOneBy({ id });
  }

  async deleteGroup(id: number): Promise<boolean> {
    const group = await this.groupRepo.findOneBy({ id });
    if (!group) return false;
    // Unassign users from this group before deleting
    await this.userRepo
      .createQueryBuilder()
      .update(UserEntity)
      .set({ groupId: null })
      .where('group_id = :groupId', { groupId: id })
      .execute();
    await this.groupRepo.remove(group);
    return true;
  }

  private sanitizeUser(user: UserEntity) {
    const { passwordHash, ...rest } = user;
    return rest;
  }
}

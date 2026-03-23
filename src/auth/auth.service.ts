import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { UserEntity } from './user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
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
      role: user.role,
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
    const user = this.userRepo.create({
      username: dto.username,
      passwordHash: hash,
      displayName: dto.displayName || null,
      role: dto.role || 'user',
      permissions: dto.permissions || {},
    });
    const saved = await this.userRepo.save(user);
    return this.sanitizeUser(saved);
  }

  async updateUser(id: number, dto: UpdateUserDto): Promise<any> {
    const user = await this.userRepo.findOneBy({ id });
    if (!user) return null;

    if (dto.displayName !== undefined) user.displayName = dto.displayName;
    if (dto.role !== undefined) user.role = dto.role;
    if (dto.permissions !== undefined) user.permissions = dto.permissions;
    if (dto.active !== undefined) user.active = dto.active;
    if (dto.password) {
      user.passwordHash = await bcrypt.hash(dto.password, 10);
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

  private sanitizeUser(user: UserEntity) {
    const { passwordHash, ...rest } = user;
    return rest;
  }
}

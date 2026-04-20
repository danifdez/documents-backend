import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UserEntity } from './user.entity';
import { PermissionGroupEntity } from './permission-group.entity';
import { AuthService } from './auth.service';
import { AvatarService } from './avatar.service';
import { AuthController } from './auth.controller';
import { UsersController } from './users.controller';
import { UserAvatarController } from './user-avatar.controller';
import { GroupsController } from './groups.controller';
import { JwtStrategy } from './jwt.strategy';
import { getJwtSecret } from './jwt-secret.helper';
import { FileStorageModule } from '../file-storage/file-storage.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, PermissionGroupEntity]),
    PassportModule,
    FileStorageModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: getJwtSecret(configService),
        signOptions: { expiresIn: '15m' },
      }),
    }),
  ],
  controllers: [AuthController, UsersController, UserAvatarController, GroupsController],
  providers: [AuthService, AvatarService, JwtStrategy],
  exports: [AuthService, JwtModule],
})
export class AuthModule { }

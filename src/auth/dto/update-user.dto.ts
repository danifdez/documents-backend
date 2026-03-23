import { IsString, IsOptional, IsEnum, IsObject, IsBoolean } from 'class-validator';
import { UserRole } from '../user-role.enum';

export class UpdateUserDto {
  @IsString()
  @IsOptional()
  displayName?: string;

  @IsString()
  @IsOptional()
  password?: string;

  @IsEnum(UserRole)
  @IsOptional()
  role?: UserRole;

  @IsObject()
  @IsOptional()
  permissions?: Record<string, boolean>;

  @IsBoolean()
  @IsOptional()
  active?: boolean;
}

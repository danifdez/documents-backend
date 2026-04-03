import { IsString, IsOptional, IsObject, IsBoolean, IsInt } from 'class-validator';

export class UpdateUserDto {
  @IsString()
  @IsOptional()
  displayName?: string;

  @IsString()
  @IsOptional()
  password?: string;

  @IsObject()
  @IsOptional()
  permissions?: Record<string, boolean>;

  @IsBoolean()
  @IsOptional()
  active?: boolean;

  @IsInt()
  @IsOptional()
  groupId?: number | null;
}

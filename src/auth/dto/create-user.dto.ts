import { IsString, IsNotEmpty, IsOptional, IsObject, IsInt } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  username: string;

  @IsString()
  @IsNotEmpty()
  password: string;

  @IsString()
  @IsOptional()
  displayName?: string;

  @IsObject()
  @IsOptional()
  permissions?: Record<string, boolean>;

  @IsInt()
  @IsOptional()
  groupId?: number | null;
}

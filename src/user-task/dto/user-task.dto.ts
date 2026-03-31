import { IsString, IsNotEmpty, IsOptional, IsNumber, IsIn, MaxLength } from 'class-validator';

export class CreateUserTaskDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  @IsIn(['pending', 'completed'])
  status?: 'pending' | 'completed';

  @IsNumber()
  @IsOptional()
  projectId?: number;
}

export class UpdateUserTaskDto {
  @IsString()
  @IsOptional()
  @MaxLength(200)
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  @IsIn(['pending', 'completed'])
  status?: 'pending' | 'completed';

  @IsNumber()
  @IsOptional()
  projectId?: number;
}

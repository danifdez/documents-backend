import {
    IsString,
    IsNotEmpty,
    IsOptional,
    IsNumber,
    IsIn,
    IsDateString,
    MaxLength,
    ValidateIf,
} from 'class-validator';

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

    @IsOptional()
    @ValidateIf((_, v) => v !== null)
    @IsDateString()
    reminderAt?: string | null;

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

    @IsOptional()
    @ValidateIf((_, v) => v !== null)
    @IsDateString()
    reminderAt?: string | null;

    @IsNumber()
    @IsOptional()
    projectId?: number;
}

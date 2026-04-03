import { IsString, IsNotEmpty, IsOptional, IsObject, IsArray, IsBoolean, IsNumber, IsIn } from 'class-validator';
import { FieldMapping } from '../data-source.entity';

export class CreateDataSourceDto {
    @IsString()
    @IsNotEmpty()
    name: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsString()
    @IsNotEmpty()
    providerType: string;

    @IsObject()
    config: Record<string, any>;

    @IsObject()
    @IsOptional()
    credentials?: Record<string, any>;

    @IsArray()
    @IsOptional()
    schemaMapping?: FieldMapping[];

    @IsString()
    @IsOptional()
    syncSchedule?: string;

    @IsString()
    @IsOptional()
    @IsIn(['full', 'incremental'])
    syncStrategy?: 'full' | 'incremental';

    @IsString()
    @IsOptional()
    incrementalKey?: string;

    @IsNumber()
    @IsOptional()
    projectId?: number;

    @IsBoolean()
    @IsOptional()
    enabled?: boolean;

    @IsNumber()
    @IsOptional()
    rateLimitRpm?: number;
}

export class UpdateDataSourceDto {
    @IsString()
    @IsOptional()
    name?: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsObject()
    @IsOptional()
    config?: Record<string, any>;

    @IsObject()
    @IsOptional()
    credentials?: Record<string, any>;

    @IsArray()
    @IsOptional()
    schemaMapping?: FieldMapping[];

    @IsString()
    @IsOptional()
    syncSchedule?: string;

    @IsString()
    @IsOptional()
    @IsIn(['full', 'incremental'])
    syncStrategy?: 'full' | 'incremental';

    @IsString()
    @IsOptional()
    incrementalKey?: string;

    @IsNumber()
    @IsOptional()
    projectId?: number;

    @IsBoolean()
    @IsOptional()
    enabled?: boolean;

    @IsNumber()
    @IsOptional()
    rateLimitRpm?: number;
}

export class TestDataSourceDto {
    @IsString()
    @IsNotEmpty()
    providerType: string;

    @IsObject()
    config: Record<string, any>;

    @IsObject()
    @IsOptional()
    credentials?: Record<string, any>;
}

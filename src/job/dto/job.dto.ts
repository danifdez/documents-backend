import { IsNotEmpty, IsOptional, IsNumber, IsEnum, IsString } from 'class-validator';
import { JobType } from '../job-type.enum';

export class CreateJobDto {
    @IsEnum(JobType)
    @IsNotEmpty()
    type: JobType;

    @IsString()
    @IsOptional()
    content?: string;

    @IsString()
    @IsOptional()
    sourceLanguage?: string;

    @IsString()
    @IsOptional()
    targetLanguage?: string;

    @IsNumber()
    @IsOptional()
    resourceId?: number;
}

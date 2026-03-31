import { IsString, IsNotEmpty, IsOptional, IsNumber } from 'class-validator';

export class CreateJobDto {
    @IsString()
    @IsNotEmpty()
    type: string;

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

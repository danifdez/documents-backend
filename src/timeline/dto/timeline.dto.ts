import { IsString, IsNotEmpty, IsOptional, IsNumber, IsArray, IsBoolean, IsIn, IsObject, IsDateString, MaxLength } from 'class-validator';
import { TimelineLayoutType } from '../timeline.entity';

export class CreateTimelineDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(200)
    name: string;

    @IsArray()
    @IsOptional()
    timelineData?: any[];

    @IsArray()
    @IsOptional()
    epochs?: any[];

    @IsString()
    @IsOptional()
    notes?: string;

    @IsNumber()
    @IsOptional()
    syncDatasetId?: number;

    @IsObject()
    @IsOptional()
    syncMapping?: Record<string, string>;

    @IsString()
    @IsOptional()
    @IsIn(['horizontal', 'vertical'])
    layoutType?: TimelineLayoutType;

    @IsBoolean()
    @IsOptional()
    axisBreaks?: boolean;

    @IsNumber()
    @IsOptional()
    projectId?: number;
}

export class UpdateTimelineDto {
    @IsString()
    @IsOptional()
    @MaxLength(200)
    name?: string;

    @IsArray()
    @IsOptional()
    timelineData?: any[];

    @IsArray()
    @IsOptional()
    epochs?: any[];

    @IsString()
    @IsOptional()
    notes?: string;

    @IsNumber()
    @IsOptional()
    syncDatasetId?: number;

    @IsObject()
    @IsOptional()
    syncMapping?: Record<string, string>;

    @IsString()
    @IsOptional()
    @IsIn(['horizontal', 'vertical'])
    layoutType?: TimelineLayoutType;

    @IsBoolean()
    @IsOptional()
    axisBreaks?: boolean;

    @IsNumber()
    @IsOptional()
    projectId?: number;
}

export class AppendTimelineEventDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(200)
    title: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsDateString()
    @IsNotEmpty()
    date: string;

    @IsDateString()
    @IsOptional()
    endDate?: string;

    @IsString()
    @IsOptional()
    @MaxLength(20)
    color?: string;

    @IsNumber()
    @IsOptional()
    docId?: number;

    @IsNumber()
    @IsOptional()
    resourceId?: number;
}

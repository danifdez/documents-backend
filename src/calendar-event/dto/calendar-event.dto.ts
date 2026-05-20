import {
    IsString,
    IsNotEmpty,
    IsOptional,
    IsNumber,
    IsBoolean,
    IsDate,
    MaxLength,
    Matches,
    ValidateNested,
    IsInt,
    Min,
    Max,
    IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AlarmDescriptorDto {
    @IsInt()
    @Min(-10080)
    @Max(0)
    offsetMinutes: number;

    @IsString()
    @IsOptional()
    @MaxLength(100)
    label?: string;
}

const RRULE_PREFIX = /^FREQ=/;

export class CreateCalendarEventDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(200)
    title: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsDate()
    @Type(() => Date)
    @IsNotEmpty()
    startDate: Date;

    @IsDate()
    @Type(() => Date)
    @IsOptional()
    endDate?: Date;

    @IsString()
    @IsOptional()
    @MaxLength(20)
    color?: string;

    @IsBoolean()
    @IsOptional()
    allDay?: boolean;

    @IsString()
    @IsOptional()
    @MaxLength(500)
    @Matches(RRULE_PREFIX, { message: 'recurrenceRule must start with "FREQ="' })
    recurrenceRule?: string;

    @IsOptional()
    @IsObject()
    @ValidateNested()
    @Type(() => AlarmDescriptorDto)
    alarm?: AlarmDescriptorDto | null;

    @IsNumber()
    @IsOptional()
    projectId?: number;
}

export class UpdateCalendarEventDto {
    @IsString()
    @IsOptional()
    @MaxLength(200)
    title?: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsDate()
    @Type(() => Date)
    @IsOptional()
    startDate?: Date;

    @IsDate()
    @Type(() => Date)
    @IsOptional()
    endDate?: Date;

    @IsString()
    @IsOptional()
    @MaxLength(20)
    color?: string;

    @IsBoolean()
    @IsOptional()
    allDay?: boolean;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    @Matches(RRULE_PREFIX, { message: 'recurrenceRule must start with "FREQ="' })
    recurrenceRule?: string | null;

    @IsOptional()
    @ValidateNested()
    @Type(() => AlarmDescriptorDto)
    alarm?: AlarmDescriptorDto | null;

    @IsNumber()
    @IsOptional()
    projectId?: number;
}

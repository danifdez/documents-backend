import { IsString, IsNotEmpty, IsOptional, IsNumber, IsBoolean, IsDate, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

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

    @IsNumber()
    @IsOptional()
    projectId?: number;
}

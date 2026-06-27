import { IsOptional, IsArray, IsBoolean, IsNumber } from 'class-validator';

export class ExportProjectsDto {
    @IsArray()
    @IsOptional()
    @IsNumber({}, { each: true })
    projectIds?: number[];

    @IsBoolean()
    @IsOptional()
    convertToDocx?: boolean;
}

import { IsOptional, IsArray, IsBoolean, IsNumber } from 'class-validator';

export class ExportProjectsDto {
    @IsArray()
    @IsOptional()
    @IsNumber({}, { each: true })
    projectIds?: number[];

    @IsBoolean()
    @IsOptional()
    includeOriginalFiles?: boolean;

    @IsBoolean()
    @IsOptional()
    includeMetadata?: boolean;

    @IsBoolean()
    @IsOptional()
    includeContent?: boolean;

    @IsBoolean()
    @IsOptional()
    convertToDocx?: boolean;
}

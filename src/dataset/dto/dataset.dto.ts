import { IsString, IsNotEmpty, IsOptional, IsArray, IsNumber, IsBoolean, IsIn, ValidateNested, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class DatasetFieldDto {
    @IsString()
    @IsNotEmpty()
    key: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(200)
    name: string;

    @IsString()
    @IsIn(['text', 'number', 'boolean', 'date', 'datetime', 'time', 'select'])
    type: 'text' | 'number' | 'boolean' | 'date' | 'datetime' | 'time' | 'select';

    @IsBoolean()
    required: boolean;

    @IsArray()
    @IsOptional()
    @IsString({ each: true })
    options?: string[];

    @IsNumber()
    @IsOptional()
    linkedDatasetId?: number;

    @IsString()
    @IsOptional()
    linkedLookupField?: string;

    @IsString()
    @IsOptional()
    linkedDisplayField?: string;
}

export class CreateDatasetDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(200)
    name: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsNumber()
    @IsOptional()
    projectId?: number;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => DatasetFieldDto)
    schema: DatasetFieldDto[];
}

export class UpdateDatasetDto {
    @IsString()
    @IsOptional()
    @MaxLength(200)
    name?: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsNumber()
    @IsOptional()
    projectId?: number;

    @IsArray()
    @IsOptional()
    @ValidateNested({ each: true })
    @Type(() => DatasetFieldDto)
    schema?: DatasetFieldDto[];
}

export class CreateDatasetRecordDto {
    @IsNotEmpty()
    data: Record<string, any>;
}

export class UpdateDatasetRecordDto {
    @IsNotEmpty()
    data: Record<string, any>;
}

export class CreateDatasetRelationDto {
    @IsString()
    @IsOptional()
    name?: string;

    @IsNumber()
    @IsNotEmpty()
    sourceDatasetId: number;

    @IsNumber()
    @IsNotEmpty()
    targetDatasetId: number;

    @IsString()
    @IsIn(['one-to-many', 'many-to-many'])
    relationType: string;
}

export class LinkRecordsDto {
    @IsNumber()
    @IsNotEmpty()
    sourceRecordId: number;

    @IsNumber()
    @IsNotEmpty()
    targetRecordId: number;
}

export class CsvImportMappingDto {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CsvColumnMappingDto)
    mappings: CsvColumnMappingDto[];

    @IsBoolean()
    @IsOptional()
    skipFirstRow?: boolean;
}

export class CsvColumnMappingDto {
    @IsString()
    @IsNotEmpty()
    csvColumn: string;

    @IsString()
    @IsNotEmpty()
    fieldKey: string;
}

export class BulkDeleteRecordsDto {
    @IsArray()
    @IsNumber({}, { each: true })
    recordIds: number[];
}

export class CreateDatasetChartDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(200)
    name: string;

    @IsNotEmpty()
    config: Record<string, any>;
}

export class UpdateDatasetChartDto {
    @IsString()
    @IsOptional()
    @MaxLength(200)
    name?: string;

    @IsOptional()
    config?: Record<string, any>;
}

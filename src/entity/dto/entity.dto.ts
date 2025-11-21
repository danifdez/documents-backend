import { IsString, IsNotEmpty, IsOptional, IsArray, IsNumber, MaxLength, ValidateNested, IsObject, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

export interface EntityTranslation {
    [locale: string]: string;
}

export class EntityAliasDto {
    @IsString()
    @IsNotEmpty()
    locale: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(200)
    value: string;
}

export class CreateEntityDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(200)
    name: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsObject()
    @IsOptional()
    translations?: EntityTranslation;

    @IsArray()
    @IsOptional()
    @ValidateNested({ each: true })
    @Type(() => EntityAliasDto)
    aliases?: EntityAliasDto[];

    @IsNumber()
    @IsNotEmpty()
    entityTypeId: number;

    @IsBoolean()
    @IsOptional()
    global?: boolean;

    @IsArray()
    @IsOptional()
    @IsNumber({}, { each: true })
    projectIds?: number[];
}

export class UpdateEntityDto {
    @IsString()
    @IsOptional()
    @MaxLength(200)
    name?: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsObject()
    @IsOptional()
    translations?: EntityTranslation;

    @IsArray()
    @IsOptional()
    @ValidateNested({ each: true })
    @Type(() => EntityAliasDto)
    aliases?: EntityAliasDto[];

    @IsNumber()
    @IsOptional()
    entityTypeId?: number;

    @IsBoolean()
    @IsOptional()
    global?: boolean;

    @IsArray()
    @IsOptional()
    @IsNumber({}, { each: true })
    projectIds?: number[];
}
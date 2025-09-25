import { IsString, IsNotEmpty, IsOptional, IsArray, IsNumber, MaxLength } from 'class-validator';

export class CreateEntityDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(200)
    name: string;

    @IsArray()
    @IsOptional()
    aliases?: string[];

    @IsNumber()
    @IsNotEmpty()
    entityTypeId: number;
}

export class UpdateEntityDto {
    @IsString()
    @IsOptional()
    @MaxLength(200)
    name?: string;

    @IsArray()
    @IsOptional()
    aliases?: string[];

    @IsNumber()
    @IsOptional()
    entityTypeId?: number;
}
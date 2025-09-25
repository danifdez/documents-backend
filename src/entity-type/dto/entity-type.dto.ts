import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

export class CreateEntityTypeDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(100)
    name: string;

    @IsString()
    @IsOptional()
    @MaxLength(500)
    description?: string;
}

export class UpdateEntityTypeDto {
    @IsString()
    @IsOptional()
    @MaxLength(100)
    name?: string;

    @IsString()
    @IsOptional()
    @MaxLength(500)
    description?: string;
}
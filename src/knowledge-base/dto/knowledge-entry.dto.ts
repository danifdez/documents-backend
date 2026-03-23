import { IsString, IsNotEmpty, IsOptional, IsArray, MaxLength } from 'class-validator';

export class CreateKnowledgeEntryDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(300)
    title: string;

    @IsString()
    @IsOptional()
    content?: string;

    @IsString()
    @IsOptional()
    @MaxLength(500)
    summary?: string;

    @IsArray()
    @IsOptional()
    @IsString({ each: true })
    tags?: string[];
}

export class UpdateKnowledgeEntryDto {
    @IsString()
    @IsOptional()
    @MaxLength(300)
    title?: string;

    @IsString()
    @IsOptional()
    content?: string;

    @IsString()
    @IsOptional()
    @MaxLength(500)
    summary?: string;

    @IsArray()
    @IsOptional()
    @IsString({ each: true })
    tags?: string[];
}

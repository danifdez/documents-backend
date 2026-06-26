import { IsString, IsNotEmpty, IsOptional, IsNumber, MaxLength, Min, Max } from 'class-validator';

export class AskQuestionDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(10000)
    question: string;

    @IsNumber()
    @IsOptional()
    projectId?: number;

    @IsString()
    @IsOptional()
    requestId?: string;

    @IsString()
    @IsOptional()
    @MaxLength(500000)
    context?: string;
}

export class SummarizeDto {
    @IsString()
    @IsNotEmpty()
    targetLanguage: string;

    @IsNumber()
    @IsOptional()
    resourceId?: number;

    @IsString()
    @IsOptional()
    text?: string;

    @IsNumber()
    @IsOptional()
    targetDocId?: number;

    @IsString()
    @IsOptional()
    sourceLanguage?: string;

    @IsString()
    @IsOptional()
    type?: string;
}

export class TranslateDto {
    @IsString()
    @IsNotEmpty()
    targetLanguage: string;

    @IsNumber()
    @IsNotEmpty()
    resourceId: number;
}

export class ExtractEntitiesDto {
    @IsNumber()
    @IsNotEmpty()
    resourceId: number;
}

export class KeyPointsDto {
    @IsNumber()
    @IsNotEmpty()
    resourceId: number;

    @IsString()
    @IsOptional()
    targetLanguage?: string;
}

export class KeywordsDto {
    @IsNumber()
    @IsNotEmpty()
    resourceId: number;

    @IsString()
    @IsOptional()
    targetLanguage?: string;
}

export class SemanticSearchDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(10000)
    query: string;

    @IsNumber()
    @IsOptional()
    projectId?: number;

    @IsString()
    @IsOptional()
    requestId?: string;

    @IsNumber()
    @IsOptional()
    @Min(1)
    @Max(20)
    limit?: number;
}

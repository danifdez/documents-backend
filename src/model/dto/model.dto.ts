import { IsString, IsNotEmpty, IsOptional, IsNumber, MaxLength } from 'class-validator';

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

export class GenerateImageDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(2000)
    prompt: string;

    @IsString()
    @IsOptional()
    @MaxLength(2000)
    negativePrompt?: string;

    @IsNumber()
    @IsOptional()
    width?: number;

    @IsNumber()
    @IsOptional()
    height?: number;

    @IsNumber()
    @IsOptional()
    steps?: number;

    @IsNumber()
    @IsOptional()
    guidanceScale?: number;

    @IsNumber()
    @IsOptional()
    seed?: number;

    @IsString()
    @IsOptional()
    requestId?: string;

    @IsNumber()
    @IsOptional()
    canvasId?: number;

    @IsNumber()
    @IsOptional()
    projectId?: number;
}

export class EditImageDto {
    @IsNumber()
    @IsNotEmpty()
    resourceId: number;

    @IsString()
    @IsNotEmpty()
    @MaxLength(2000)
    prompt: string;

    @IsString()
    @IsOptional()
    @MaxLength(2000)
    negativePrompt?: string;

    @IsNumber()
    @IsOptional()
    strength?: number;

    @IsNumber()
    @IsOptional()
    steps?: number;

    @IsNumber()
    @IsOptional()
    guidanceScale?: number;

    @IsNumber()
    @IsOptional()
    seed?: number;

    @IsString()
    @IsOptional()
    requestId?: string;

    @IsNumber()
    @IsOptional()
    canvasId?: number;

    @IsNumber()
    @IsOptional()
    projectId?: number;
}

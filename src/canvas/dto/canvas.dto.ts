import { IsString, IsNotEmpty, IsOptional, IsNumber, IsObject, MaxLength } from 'class-validator';

export class CreateCanvasDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(200)
    name: string;

    @IsObject()
    @IsOptional()
    canvasData?: object;

    @IsString()
    @IsOptional()
    content?: string;

    @IsNumber()
    @IsOptional()
    threadId?: number;

    @IsNumber()
    @IsOptional()
    projectId?: number;
}

export class UpdateCanvasDto {
    @IsString()
    @IsOptional()
    @MaxLength(200)
    name?: string;

    @IsObject()
    @IsOptional()
    canvasData?: object;

    @IsString()
    @IsOptional()
    content?: string;

    @IsNumber()
    @IsOptional()
    threadId?: number;

    @IsNumber()
    @IsOptional()
    projectId?: number;
}

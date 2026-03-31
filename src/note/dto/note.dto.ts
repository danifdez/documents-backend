import { IsString, IsNotEmpty, IsOptional, IsNumber, MaxLength } from 'class-validator';

export class CreateNoteDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(200)
    title: string;

    @IsString()
    @IsOptional()
    content?: string;

    @IsNumber()
    @IsOptional()
    projectId?: number;

    @IsNumber()
    @IsOptional()
    threadId?: number;
}

export class UpdateNoteDto {
    @IsString()
    @IsOptional()
    @MaxLength(200)
    title?: string;

    @IsString()
    @IsOptional()
    content?: string;

    @IsNumber()
    @IsOptional()
    projectId?: number;

    @IsNumber()
    @IsOptional()
    threadId?: number;
}

import { IsString, IsNotEmpty, IsOptional, IsNumber, MaxLength } from 'class-validator';

export class CreateRelationshipDto {
    @IsNumber()
    @IsNotEmpty()
    subjectId: number;

    @IsString()
    @IsNotEmpty()
    @MaxLength(200)
    predicate: string;

    @IsNumber()
    @IsNotEmpty()
    objectId: number;

    @IsNumber()
    @IsNotEmpty()
    resourceId: number;

    @IsNumber()
    @IsOptional()
    projectId?: number;

    @IsString()
    @IsOptional()
    requestId?: string;
}

export class UpdateRelationshipDto {
    @IsNumber()
    @IsNotEmpty()
    subjectId: number;

    @IsString()
    @IsNotEmpty()
    @MaxLength(200)
    predicate: string;

    @IsNumber()
    @IsNotEmpty()
    objectId: number;

    @IsString()
    @IsNotEmpty()
    @MaxLength(200)
    newPredicate: string;

    @IsNumber()
    @IsNotEmpty()
    resourceId: number;

    @IsString()
    @IsOptional()
    requestId?: string;
}

export class DeleteRelationshipDto {
    @IsNumber()
    @IsNotEmpty()
    subjectId: number;

    @IsString()
    @IsNotEmpty()
    @MaxLength(200)
    predicate: string;

    @IsNumber()
    @IsNotEmpty()
    objectId: number;

    @IsNumber()
    @IsNotEmpty()
    resourceId: number;

    @IsString()
    @IsOptional()
    requestId?: string;
}

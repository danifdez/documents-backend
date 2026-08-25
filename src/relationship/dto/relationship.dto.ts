import { IsString, IsNotEmpty, IsNumber, MaxLength } from 'class-validator';

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
}

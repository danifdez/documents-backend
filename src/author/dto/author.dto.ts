import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

export class CreateAuthorDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(200)
    name: string;
}

export class UpdateAuthorDto {
    @IsString()
    @IsOptional()
    @MaxLength(200)
    name?: string;
}

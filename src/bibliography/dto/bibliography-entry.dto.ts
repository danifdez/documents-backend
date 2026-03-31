import { IsString, IsNotEmpty, IsOptional, IsNumber, IsArray, IsObject, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class BibliographyCreatorDto {
    @IsString()
    @IsNotEmpty()
    creatorType: string;

    @IsString()
    @IsOptional()
    firstName?: string;

    @IsString()
    @IsOptional()
    lastName?: string;

    @IsString()
    @IsOptional()
    name?: string;
}

export class CreateBibliographyEntryDto {
    @IsString()
    @IsOptional()
    @MaxLength(50)
    entryType?: string;

    @IsString()
    @IsOptional()
    @MaxLength(100)
    citeKey?: string;

    @IsString()
    @IsOptional()
    @MaxLength(500)
    title?: string;

    @IsString()
    @IsOptional()
    @MaxLength(200)
    shortTitle?: string;

    @IsArray()
    @IsOptional()
    @ValidateNested({ each: true })
    @Type(() => BibliographyCreatorDto)
    creators?: BibliographyCreatorDto[];

    @IsString()
    @IsOptional()
    @MaxLength(10)
    year?: string;

    @IsString()
    @IsOptional()
    abstract?: string;

    @IsString()
    @IsOptional()
    @MaxLength(200)
    journal?: string;

    @IsString()
    @IsOptional()
    @MaxLength(100)
    journalAbbreviation?: string;

    @IsString()
    @IsOptional()
    @MaxLength(500)
    booktitle?: string;

    @IsString()
    @IsOptional()
    @MaxLength(200)
    conferenceName?: string;

    @IsString()
    @IsOptional()
    @MaxLength(50)
    volume?: string;

    @IsString()
    @IsOptional()
    @MaxLength(50)
    number?: string;

    @IsString()
    @IsOptional()
    @MaxLength(50)
    pages?: string;

    @IsString()
    @IsOptional()
    @MaxLength(200)
    publisher?: string;

    @IsString()
    @IsOptional()
    @MaxLength(200)
    place?: string;

    @IsString()
    @IsOptional()
    @MaxLength(50)
    edition?: string;

    @IsString()
    @IsOptional()
    @MaxLength(200)
    series?: string;

    @IsString()
    @IsOptional()
    @MaxLength(50)
    seriesNumber?: string;

    @IsString()
    @IsOptional()
    @MaxLength(50)
    numberOfVolumes?: string;

    @IsString()
    @IsOptional()
    @MaxLength(50)
    numberOfPages?: string;

    @IsString()
    @IsOptional()
    @MaxLength(100)
    doi?: string;

    @IsString()
    @IsOptional()
    @MaxLength(30)
    isbn?: string;

    @IsString()
    @IsOptional()
    @MaxLength(30)
    issn?: string;

    @IsString()
    @IsOptional()
    @MaxLength(2000)
    url?: string;

    @IsString()
    @IsOptional()
    @MaxLength(50)
    accessDate?: string;

    @IsString()
    @IsOptional()
    @MaxLength(200)
    websiteTitle?: string;

    @IsString()
    @IsOptional()
    @MaxLength(100)
    websiteType?: string;

    @IsString()
    @IsOptional()
    @MaxLength(200)
    institution?: string;

    @IsString()
    @IsOptional()
    @MaxLength(200)
    university?: string;

    @IsString()
    @IsOptional()
    @MaxLength(100)
    thesisType?: string;

    @IsString()
    @IsOptional()
    @MaxLength(100)
    reportNumber?: string;

    @IsString()
    @IsOptional()
    @MaxLength(100)
    reportType?: string;

    @IsString()
    @IsOptional()
    @MaxLength(200)
    archive?: string;

    @IsString()
    @IsOptional()
    @MaxLength(200)
    archiveLocation?: string;

    @IsString()
    @IsOptional()
    @MaxLength(100)
    callNumber?: string;

    @IsString()
    @IsOptional()
    @MaxLength(50)
    language?: string;

    @IsString()
    @IsOptional()
    rights?: string;

    @IsString()
    @IsOptional()
    note?: string;

    @IsString()
    @IsOptional()
    extra?: string;

    @IsObject()
    @IsOptional()
    extraFields?: Record<string, string>;

    @IsNumber()
    @IsOptional()
    projectId?: number;

    @IsNumber()
    @IsOptional()
    sourceResourceId?: number;
}

export class UpdateBibliographyEntryDto extends CreateBibliographyEntryDto { }

import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBibliographyEntries1757668140024 implements MigrationInterface {
    name = 'CreateBibliographyEntries1757668140024'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "bibliography_entries" (
                "id" SERIAL NOT NULL,
                "entry_type" character varying NOT NULL DEFAULT 'misc',
                "cite_key" character varying,
                "title" character varying,
                "creators" json,
                "year" character varying,
                "journal" character varying,
                "booktitle" character varying,
                "volume" character varying,
                "number" character varying,
                "pages" character varying,
                "publisher" character varying,
                "place" character varying,
                "url" character varying,
                "doi" character varying,
                "isbn" character varying,
                "edition" character varying,
                "note" text,
                "extra_fields" json,
                "abstract" text,
                "access_date" character varying,
                "archive" character varying,
                "archive_location" character varying,
                "call_number" character varying,
                "short_title" character varying,
                "language" character varying,
                "rights" character varying,
                "extra" text,
                "conference_name" character varying,
                "website_title" character varying,
                "website_type" character varying,
                "thesis_type" character varying,
                "university" character varying,
                "institution" character varying,
                "series" character varying,
                "series_number" character varying,
                "number_of_volumes" character varying,
                "number_of_pages" character varying,
                "issn" character varying,
                "report_number" character varying,
                "report_type" character varying,
                "journal_abbreviation" character varying,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                "projectId" integer,
                "sourceResourceId" integer,
                CONSTRAINT "PK_bibliography_entries" PRIMARY KEY ("id"),
                CONSTRAINT "FK_bibliography_entries_project" FOREIGN KEY ("projectId")
                    REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
                CONSTRAINT "FK_bibliography_entries_resource" FOREIGN KEY ("sourceResourceId")
                    REFERENCES "resources"("id") ON DELETE SET NULL ON UPDATE NO ACTION
            )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "bibliography_entries"`);
    }
}

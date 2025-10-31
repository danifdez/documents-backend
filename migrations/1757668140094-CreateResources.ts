import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateResources1757668140094 implements MigrationInterface {
    name = 'CreateResources1757668140094'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "resources" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, "hash" character varying, "related_to" character varying, "type" character varying, "mime_type" character varying, "original_name" character varying, "upload_date" character varying, "file_size" integer, "path" character varying, "url" character varying, "title" character varying, "pages" integer, "publication_date" character varying, "content" text, "translated_content" text, "working_content" text, "summary" text, "language" character varying, "license" character varying, "confirmation_status" character varying DEFAULT 'confirmed', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "projectId" integer, CONSTRAINT "PK_632484ab9dff41bba94f9b7c85e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "resources" ADD CONSTRAINT "FK_29eb31f2e03a948855f99de62df" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "resources" DROP CONSTRAINT "FK_29eb31f2e03a948855f99de62df"`);
        await queryRunner.query(`DROP TABLE "resources"`);
    }

}

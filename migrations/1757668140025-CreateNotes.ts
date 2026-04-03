import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNotes1757668140025 implements MigrationInterface {
    name = 'CreateNotes1757668140025'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "notes" ("id" SERIAL NOT NULL, "title" character varying NOT NULL, "content" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "projectId" integer, "threadId" integer, CONSTRAINT "PK_notes" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "notes" ADD CONSTRAINT "FK_notes_project" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "notes" ADD CONSTRAINT "FK_notes_thread" FOREIGN KEY ("threadId") REFERENCES "threads"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "notes" DROP CONSTRAINT "FK_notes_thread"`);
        await queryRunner.query(`ALTER TABLE "notes" DROP CONSTRAINT "FK_notes_project"`);
        await queryRunner.query(`DROP TABLE "notes"`);
    }
}

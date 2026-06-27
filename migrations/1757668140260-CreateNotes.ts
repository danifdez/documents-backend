import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNotes1757668140260 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "notes" ("id" SERIAL NOT NULL, "title" character varying NOT NULL, "content" text, "status" character varying(16) NOT NULL DEFAULT 'active', "projectId" integer, "threadId" integer, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_notes" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_notes_status" ON "notes" ("status")`);
    await queryRunner.query(`ALTER TABLE "notes" ADD CONSTRAINT "FK_notes_project" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "notes" ADD CONSTRAINT "FK_notes_thread" FOREIGN KEY ("threadId") REFERENCES "threads"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "notes"`);
  }
}

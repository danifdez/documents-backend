import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCanvases1757668140023 implements MigrationInterface {
    name = 'CreateCanvases1757668140023'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "canvases" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, "canvas_data" jsonb, "content" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "threadId" integer, "projectId" integer, CONSTRAINT "PK_canvases" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "canvases" ADD CONSTRAINT "FK_canvases_thread" FOREIGN KEY ("threadId") REFERENCES "threads"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "canvases" ADD CONSTRAINT "FK_canvases_project" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "canvases" DROP CONSTRAINT "FK_canvases_project"`);
        await queryRunner.query(`ALTER TABLE "canvases" DROP CONSTRAINT "FK_canvases_thread"`);
        await queryRunner.query(`DROP TABLE "canvases"`);
    }
}

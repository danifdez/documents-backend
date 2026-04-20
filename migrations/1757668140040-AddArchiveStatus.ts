import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddArchiveStatus1757668140040 implements MigrationInterface {
    name = 'AddArchiveStatus1757668140040'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "projects" ADD COLUMN "status" VARCHAR(16) NOT NULL DEFAULT 'active'`);
        await queryRunner.query(`CREATE INDEX "IDX_projects_status" ON "projects" ("status")`);

        await queryRunner.query(`ALTER TABLE "threads" ADD COLUMN "status" VARCHAR(16) NOT NULL DEFAULT 'active'`);
        await queryRunner.query(`CREATE INDEX "IDX_threads_status" ON "threads" ("status")`);

        await queryRunner.query(`ALTER TABLE "docs" ADD COLUMN "status" VARCHAR(16) NOT NULL DEFAULT 'active'`);
        await queryRunner.query(`CREATE INDEX "IDX_docs_status" ON "docs" ("status")`);

        await queryRunner.query(`ALTER TABLE "notes" ADD COLUMN "status" VARCHAR(16) NOT NULL DEFAULT 'active'`);
        await queryRunner.query(`CREATE INDEX "IDX_notes_status" ON "notes" ("status")`);

        await queryRunner.query(`ALTER TABLE "resources" ADD COLUMN "archived_at" TIMESTAMP NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_resources_archived_at" ON "resources" ("archived_at")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_resources_archived_at"`);
        await queryRunner.query(`ALTER TABLE "resources" DROP COLUMN "archived_at"`);

        await queryRunner.query(`DROP INDEX "IDX_notes_status"`);
        await queryRunner.query(`ALTER TABLE "notes" DROP COLUMN "status"`);

        await queryRunner.query(`DROP INDEX "IDX_docs_status"`);
        await queryRunner.query(`ALTER TABLE "docs" DROP COLUMN "status"`);

        await queryRunner.query(`DROP INDEX "IDX_threads_status"`);
        await queryRunner.query(`ALTER TABLE "threads" DROP COLUMN "status"`);

        await queryRunner.query(`DROP INDEX "IDX_projects_status"`);
        await queryRunner.query(`ALTER TABLE "projects" DROP COLUMN "status"`);
    }
}

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

        await queryRunner.query(`
            DO $$ BEGIN
                IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'notes') THEN
                    ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "status" VARCHAR(16) NOT NULL DEFAULT 'active';
                    CREATE INDEX IF NOT EXISTS "IDX_notes_status" ON "notes" ("status");
                END IF;
            END $$;
        `);

        await queryRunner.query(`ALTER TABLE "resources" ADD COLUMN "archived_at" TIMESTAMP NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_resources_archived_at" ON "resources" ("archived_at")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_resources_archived_at"`);
        await queryRunner.query(`ALTER TABLE "resources" DROP COLUMN "archived_at"`);

        await queryRunner.query(`
            DO $$ BEGIN
                IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'notes') THEN
                    DROP INDEX IF EXISTS "IDX_notes_status";
                    ALTER TABLE "notes" DROP COLUMN IF EXISTS "status";
                END IF;
            END $$;
        `);

        await queryRunner.query(`DROP INDEX "IDX_docs_status"`);
        await queryRunner.query(`ALTER TABLE "docs" DROP COLUMN "status"`);

        await queryRunner.query(`DROP INDEX "IDX_threads_status"`);
        await queryRunner.query(`ALTER TABLE "threads" DROP COLUMN "status"`);

        await queryRunner.query(`DROP INDEX "IDX_projects_status"`);
        await queryRunner.query(`ALTER TABLE "projects" DROP COLUMN "status"`);
    }
}

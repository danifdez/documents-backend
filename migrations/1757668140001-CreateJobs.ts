import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateJobs1757668140001 implements MigrationInterface {
    name = 'CreateJobs1757668140001'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "jobs" ("id" SERIAL NOT NULL, "type" character varying NOT NULL, "priority" character varying DEFAULT 'normal', "payload" jsonb, "status" character varying NOT NULL DEFAULT 'pending', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "expires_at" TIMESTAMP, "result" jsonb, "claimed_by" UUID, "retry_count" INTEGER NOT NULL DEFAULT 0, "started_at" TIMESTAMP, CONSTRAINT "PK_cf0a6c42b72fcc7f7c237def345" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_jobs_status_priority" ON "jobs" ("status", "priority")`);
        await queryRunner.query(`CREATE INDEX "IDX_jobs_claimed_by" ON "jobs" ("claimed_by")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_jobs_claimed_by"`);
        await queryRunner.query(`DROP INDEX "IDX_jobs_status_priority"`);
        await queryRunner.query(`DROP TABLE "jobs"`);
    }
}

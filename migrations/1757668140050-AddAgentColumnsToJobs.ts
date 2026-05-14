import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAgentColumnsToJobs1757668140050 implements MigrationInterface {
    name = 'AddAgentColumnsToJobs1757668140050'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "jobs" ADD COLUMN "agent_iteration" INTEGER NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "jobs" ADD COLUMN "agent_max_steps" INTEGER NOT NULL DEFAULT 1`);
        await queryRunner.query(`ALTER TABLE "jobs" ADD COLUMN "agent_state" jsonb`);
        await queryRunner.query(`ALTER TABLE "jobs" ADD COLUMN "parent_job_id" INTEGER`);
        await queryRunner.query(`ALTER TABLE "jobs" ADD COLUMN "agent_kind" character varying`);
        await queryRunner.query(`ALTER TABLE "jobs" ADD CONSTRAINT "FK_jobs_parent_job" FOREIGN KEY ("parent_job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`CREATE INDEX "IDX_jobs_parent_job_id" ON "jobs" ("parent_job_id")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_jobs_parent_job_id"`);
        await queryRunner.query(`ALTER TABLE "jobs" DROP CONSTRAINT "FK_jobs_parent_job"`);
        await queryRunner.query(`ALTER TABLE "jobs" DROP COLUMN "agent_kind"`);
        await queryRunner.query(`ALTER TABLE "jobs" DROP COLUMN "parent_job_id"`);
        await queryRunner.query(`ALTER TABLE "jobs" DROP COLUMN "agent_state"`);
        await queryRunner.query(`ALTER TABLE "jobs" DROP COLUMN "agent_max_steps"`);
        await queryRunner.query(`ALTER TABLE "jobs" DROP COLUMN "agent_iteration"`);
    }
}

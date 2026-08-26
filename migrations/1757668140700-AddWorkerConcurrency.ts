import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWorkerConcurrency1757668140700 implements MigrationInterface {
  name = 'AddWorkerConcurrency1757668140700';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "workers"
      ADD COLUMN "protocol_version" varchar(50) NOT NULL DEFAULT 'step-protocol/1',
      ADD COLUMN "step_kinds" text[] NOT NULL DEFAULT '{}',
      ADD COLUMN "maximum_concurrency" integer NOT NULL DEFAULT 1,
      ADD CONSTRAINT "CHK_workers_maximum_concurrency"
        CHECK ("maximum_concurrency" BETWEEN 1 AND 64)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "workers"
      DROP CONSTRAINT "CHK_workers_maximum_concurrency",
      DROP COLUMN "maximum_concurrency",
      DROP COLUMN "step_kinds",
      DROP COLUMN "protocol_version"
    `);
  }
}

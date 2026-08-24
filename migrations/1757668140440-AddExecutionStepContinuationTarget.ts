import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExecutionStepContinuationTarget1757668140440
  implements MigrationInterface
{
  name = 'AddExecutionStepContinuationTarget1757668140440';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "execution_steps"
      ADD COLUMN "continuation_step_id" uuid
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_execution_steps_continuation_step"
      ON "execution_steps" ("continuation_step_id")
      WHERE "continuation_step_id" IS NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "execution_steps"
      ADD CONSTRAINT "FK_execution_steps_continuation_step"
      FOREIGN KEY ("continuation_step_id") REFERENCES "execution_steps"("step_id")
      ON DELETE SET NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "execution_steps"
      DROP CONSTRAINT "FK_execution_steps_continuation_step"
    `);
    await queryRunner.query(`
      DROP INDEX "IDX_execution_steps_continuation_step"
    `);
    await queryRunner.query(`
      ALTER TABLE "execution_steps"
      DROP COLUMN "continuation_step_id"
    `);
  }
}

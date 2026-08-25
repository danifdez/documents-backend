import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExecutionStepFailureFinalization1757668140470 implements MigrationInterface {
  name = 'AddExecutionStepFailureFinalization1757668140470';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "execution_steps"
      ADD COLUMN "finalize_on_failure" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "execution_steps"
      DROP COLUMN "finalize_on_failure"
    `);
  }
}

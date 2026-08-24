import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExecutionStepContinuation1757668140430 implements MigrationInterface {
  name = 'AddExecutionStepContinuation1757668140430';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "execution_steps"
      ADD COLUMN "continuation_processed_at" timestamptz
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "execution_steps"
      DROP COLUMN "continuation_processed_at"
    `);
  }
}

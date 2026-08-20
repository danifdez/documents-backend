import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExecutionProgress1757668140350 implements MigrationInterface {
  name = 'AddExecutionProgress1757668140350';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "executions" ADD COLUMN "progress_policy" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "executions" ADD COLUMN "progress_ledger" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "executions" DROP COLUMN "progress_ledger"`,
    );
    await queryRunner.query(
      `ALTER TABLE "executions" DROP COLUMN "progress_policy"`,
    );
  }
}

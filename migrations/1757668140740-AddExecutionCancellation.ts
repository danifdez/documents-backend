import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExecutionCancellation1757668140740 implements MigrationInterface {
  name = 'AddExecutionCancellation1757668140740';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "executions"
        ADD COLUMN "cancellation_requested_at" timestamptz,
        ADD COLUMN "cancellation_reason" varchar(500)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_executions_cancellation_pending"
      ON "executions" ("cancellation_requested_at")
      WHERE "cancellation_requested_at" IS NOT NULL
        AND "status" NOT IN ('completed', 'failed', 'cancelled')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_executions_cancellation_pending"`);
    await queryRunner.query(`
      ALTER TABLE "executions"
        DROP COLUMN "cancellation_reason",
        DROP COLUMN "cancellation_requested_at"
    `);
  }
}

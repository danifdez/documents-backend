import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveLegacyExecutionQueueFields1757668140390 implements MigrationInterface {
  name = 'RemoveLegacyExecutionQueueFields1757668140390';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_executions_claimed_by"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_executions_queue"`);
    await queryRunner.query(`
      ALTER TABLE "executions"
        DROP COLUMN IF EXISTS "step",
        DROP COLUMN IF EXISTS "max_steps",
        DROP COLUMN IF EXISTS "claimed_by",
        DROP COLUMN IF EXISTS "retry_count",
        DROP COLUMN IF EXISTS "max_attempts",
        DROP COLUMN IF EXISTS "started_at",
        DROP COLUMN IF EXISTS "input_blob",
        DROP COLUMN IF EXISTS "result_blob",
        DROP COLUMN IF EXISTS "available_at",
        DROP COLUMN IF EXISTS "attempt_id"
    `);
  }

  // Reverting must not recreate the retired queue as a second execution authority.
  public async down(): Promise<void> {}
}

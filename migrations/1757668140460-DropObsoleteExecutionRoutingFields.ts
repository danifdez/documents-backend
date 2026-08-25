import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropObsoleteExecutionRoutingFields1757668140460 implements MigrationInterface {
  name = 'DropObsoleteExecutionRoutingFields1757668140460';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "executions"
        DROP COLUMN IF EXISTS "origin",
        DROP COLUMN IF EXISTS "priority",
        DROP COLUMN IF EXISTS "wait_reason"
    `);
  }

  // Reverting must not restore routing state outside the step graph.
  public async down(): Promise<void> {}
}

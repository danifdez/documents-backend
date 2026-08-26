import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveExecutionWorkspaceScope1757668140710 implements MigrationInterface {
  name = 'RemoveExecutionWorkspaceScope1757668140710';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_executions_access"`);
    await queryRunner.query(`
      ALTER TABLE "executions"
        DROP COLUMN IF EXISTS "workspace_id"
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_executions_owner" ON "executions" ("owner_principal")`,
    );
  }

  // Reverting must not restore workspace identity inside the execution harness.
  public async down(): Promise<void> {}
}

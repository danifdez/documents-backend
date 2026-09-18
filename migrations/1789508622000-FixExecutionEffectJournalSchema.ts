import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixExecutionEffectJournalSchema1789508622000
  implements MigrationInterface
{
  name = 'FixExecutionEffectJournalSchema1789508622000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Resolve the schema that actually holds `executions` instead of
    // `current_schema()`. Apache AGE stores each graph in its own schema, and
    // the `documents` graph shadows the `documents` database user in the
    // default `"$user", public` search_path, so `current_schema()` can point at
    // the graph schema even though the core tables live in `public`.
    const [row] = (await queryRunner.query(`
      SELECT n.nspname AS schema_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.oid = to_regclass('executions')
    `)) as { schema_name: string }[];
    const [fallback] = (await queryRunner.query(
      'SELECT current_schema() AS schema_name',
    )) as { schema_name: string }[];
    const schema = String(
      row?.schema_name ?? fallback?.schema_name ?? 'public',
    ).replace(/"/g, '""');

    await queryRunner.query(
      'ALTER TABLE "execution_effect_journal" DROP CONSTRAINT IF EXISTS "FK_execution_effect_journal_execution"',
    );
    await queryRunner.query(
      `ALTER TABLE "execution_effect_journal"
       ADD CONSTRAINT "FK_execution_effect_journal_execution"
       FOREIGN KEY ("execution_id") REFERENCES "${schema}"."executions"("execution_id")
       ON DELETE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "execution_effect_journal" DROP CONSTRAINT IF EXISTS "FK_execution_effect_journal_execution"',
    );
    await queryRunner.query(
      'ALTER TABLE "execution_effect_journal" ADD CONSTRAINT "FK_execution_effect_journal_execution" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("execution_id") ON DELETE CASCADE',
    );
  }
}

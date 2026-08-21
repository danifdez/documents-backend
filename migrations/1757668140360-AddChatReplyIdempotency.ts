import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChatReplyIdempotency1757668140360 implements MigrationInterface {
  name = 'AddChatReplyIdempotency1757668140360';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "assistant_messages" ADD COLUMN IF NOT EXISTS "execution_id" uuid',
    );
    await queryRunner.query(
      'ALTER TABLE "agent_messages" ADD COLUMN IF NOT EXISTS "execution_id" uuid',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_assistant_messages_execution_id" ON "assistant_messages" ("execution_id")',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_agent_messages_execution_id" ON "agent_messages" ("execution_id")',
    );
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'FK_assistant_messages_execution'
        ) THEN
          ALTER TABLE "assistant_messages"
          ADD CONSTRAINT "FK_assistant_messages_execution"
          FOREIGN KEY ("execution_id") REFERENCES "executions"("execution_id")
          ON DELETE SET NULL;
        END IF;
      END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'FK_agent_messages_execution'
        ) THEN
          ALTER TABLE "agent_messages"
          ADD CONSTRAINT "FK_agent_messages_execution"
          FOREIGN KEY ("execution_id") REFERENCES "executions"("execution_id")
          ON DELETE SET NULL;
        END IF;
      END $$
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_assistant_messages_execution_reply" ON "assistant_messages" ("assistant_id", "execution_id") WHERE "execution_id" IS NOT NULL AND "role" = 'assistant'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_agent_messages_execution_reply" ON "agent_messages" ("agent_id", "execution_id") WHERE "execution_id" IS NOT NULL AND "role" = 'assistant'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const assistantLegacy = await queryRunner.hasColumn(
      'assistant_messages',
      'job_id',
    );
    const agentLegacy = await queryRunner.hasColumn('agent_messages', 'job_id');
    await queryRunner.query(
      'DROP INDEX "public"."UQ_agent_messages_execution_reply"',
    );
    await queryRunner.query(
      'DROP INDEX "public"."UQ_assistant_messages_execution_reply"',
    );
    if (assistantLegacy) {
      await queryRunner.query(
        'ALTER TABLE "assistant_messages" DROP CONSTRAINT IF EXISTS "FK_assistant_messages_execution"',
      );
      await queryRunner.query(
        'DROP INDEX IF EXISTS "IDX_assistant_messages_execution_id"',
      );
      await queryRunner.query(
        'ALTER TABLE "assistant_messages" DROP COLUMN "execution_id"',
      );
    }
    if (agentLegacy) {
      await queryRunner.query(
        'ALTER TABLE "agent_messages" DROP CONSTRAINT IF EXISTS "FK_agent_messages_execution"',
      );
      await queryRunner.query(
        'DROP INDEX IF EXISTS "IDX_agent_messages_execution_id"',
      );
      await queryRunner.query(
        'ALTER TABLE "agent_messages" DROP COLUMN "execution_id"',
      );
    }
  }
}

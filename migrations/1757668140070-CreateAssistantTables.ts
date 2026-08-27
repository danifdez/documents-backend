import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAssistantTables1757668140070 implements MigrationInterface {
  name = 'CreateAssistantTables1757668140070';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "assistants" (
                "id" integer PRIMARY KEY DEFAULT 1,
                "name" character varying(100) NOT NULL,
                "folder_scope" character varying(500),
                "icon" character varying(16),
                "sub" character varying(300),
                "last_seen_at" TIMESTAMP,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "CHK_assistants_singleton" CHECK ("id" = 1)
            )
        `);

    await queryRunner.query(`
            CREATE TABLE "assistant_messages" (
                "id" SERIAL PRIMARY KEY,
                "assistant_id" integer NOT NULL,
                "role" character varying(16) NOT NULL,
                "content" text NOT NULL,
                "execution_id" uuid,
                "turn_id" uuid,
                "error" text,
                "event" jsonb,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "FK_assistant_messages_assistant" FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
                CONSTRAINT "FK_assistant_messages_execution" FOREIGN KEY ("execution_id") REFERENCES "executions"("execution_id") ON DELETE SET NULL ON UPDATE NO ACTION,
                CONSTRAINT "CHK_assistant_messages_turn" CHECK ("role" IN ('system', 'event') OR "turn_id" IS NOT NULL)
            )
        `);

    await queryRunner.query(
      `CREATE INDEX "IDX_assistant_messages_assistant_id" ON "assistant_messages" ("assistant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_assistant_messages_execution_id" ON "assistant_messages" ("execution_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_assistant_messages_assistant_id_id" ON "assistant_messages" ("assistant_id", "id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_assistant_messages_execution_reply" ON "assistant_messages" ("assistant_id", "execution_id") WHERE "execution_id" IS NOT NULL AND "role" = 'assistant'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_assistant_messages_turn_id" ON "assistant_messages" ("turn_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_assistant_messages_turn_role" ON "assistant_messages" ("turn_id", "role") WHERE "role" IN ('user', 'assistant')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_assistant_messages_turn_role"`);
    await queryRunner.query(`DROP INDEX "IDX_assistant_messages_turn_id"`);
    await queryRunner.query(
      `DROP INDEX "UQ_assistant_messages_execution_reply"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_assistant_messages_assistant_id_id"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_assistant_messages_execution_id"`);
    await queryRunner.query(`DROP INDEX "IDX_assistant_messages_assistant_id"`);
    await queryRunner.query(`DROP TABLE "assistant_messages"`);
    await queryRunner.query(`DROP TABLE "assistants"`);
  }
}

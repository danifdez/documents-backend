import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgentMessages1757668140111 implements MigrationInterface {
  name = 'CreateAgentMessages1757668140111';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "agent_messages" (
                "id" SERIAL PRIMARY KEY,
                "agent_id" integer NOT NULL,
                "role" character varying(16) NOT NULL,
                "content" text NOT NULL,
                "execution_id" uuid,
                "turn_id" uuid,
                "error" text,
                "event" jsonb,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "FK_agent_messages_agent" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
                CONSTRAINT "FK_agent_messages_execution" FOREIGN KEY ("execution_id") REFERENCES "executions"("execution_id") ON DELETE SET NULL ON UPDATE NO ACTION,
                CONSTRAINT "CHK_agent_messages_turn" CHECK ("role" IN ('system', 'event') OR "turn_id" IS NOT NULL)
            )
        `);
    await queryRunner.query(
      `CREATE INDEX "IDX_agent_messages_agent_id" ON "agent_messages" ("agent_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_agent_messages_execution_id" ON "agent_messages" ("execution_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_agent_messages_agent_id_created_at" ON "agent_messages" ("agent_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_agent_messages_agent_id_id" ON "agent_messages" ("agent_id", "id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_agent_messages_execution_reply" ON "agent_messages" ("agent_id", "execution_id") WHERE "execution_id" IS NOT NULL AND "role" = 'assistant'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_agent_messages_turn_id" ON "agent_messages" ("turn_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_agent_messages_turn_role" ON "agent_messages" ("turn_id", "role") WHERE "role" IN ('user', 'assistant')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_agent_messages_turn_role"`);
    await queryRunner.query(`DROP INDEX "IDX_agent_messages_turn_id"`);
    await queryRunner.query(`DROP INDEX "UQ_agent_messages_execution_reply"`);
    await queryRunner.query(`DROP INDEX "IDX_agent_messages_agent_id_id"`);
    await queryRunner.query(
      `DROP INDEX "IDX_agent_messages_agent_id_created_at"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_agent_messages_execution_id"`);
    await queryRunner.query(`DROP INDEX "IDX_agent_messages_agent_id"`);
    await queryRunner.query(`DROP TABLE "agent_messages"`);
  }
}

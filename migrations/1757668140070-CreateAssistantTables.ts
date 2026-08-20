import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAssistantTables1757668140070 implements MigrationInterface {
    name = 'CreateAssistantTables1757668140070'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "assistants" (
                "id" SERIAL PRIMARY KEY,
                "name" character varying(100) NOT NULL,
                "system_prompt" text,
                "folder_scope" character varying(500),
                "icon" character varying(16),
                "is_system" boolean NOT NULL DEFAULT false,
                "pinned" boolean NOT NULL DEFAULT false,
                "sub" character varying(300),
                "last_seen_at" TIMESTAMP,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now()
            )
        `);

        await queryRunner.query(`
            CREATE TABLE "assistant_messages" (
                "id" SERIAL PRIMARY KEY,
                "assistant_id" integer NOT NULL,
                "role" character varying(16) NOT NULL,
                "content" text NOT NULL,
                "execution_id" uuid,
                "error" text,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "FK_assistant_messages_assistant" FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
                CONSTRAINT "FK_assistant_messages_execution" FOREIGN KEY ("execution_id") REFERENCES "executions"("execution_id") ON DELETE SET NULL ON UPDATE NO ACTION
            )
        `);

        await queryRunner.query(`CREATE INDEX "IDX_assistant_messages_assistant_id" ON "assistant_messages" ("assistant_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_assistant_messages_execution_id" ON "assistant_messages" ("execution_id")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_assistant_messages_execution_id"`);
        await queryRunner.query(`DROP INDEX "IDX_assistant_messages_assistant_id"`);
        await queryRunner.query(`DROP TABLE "assistant_messages"`);
        await queryRunner.query(`DROP TABLE "assistants"`);
    }
}

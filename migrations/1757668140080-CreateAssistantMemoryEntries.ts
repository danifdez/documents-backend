import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAssistantMemoryEntries1757668140080 implements MigrationInterface {
    name = 'CreateAssistantMemoryEntries1757668140080'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "assistant_memory_entries" (
                "id" SERIAL PRIMARY KEY,
                "assistant_id" integer NOT NULL,
                "name" character varying(120) NOT NULL,
                "type" character varying(16) NOT NULL,
                "body" text NOT NULL,
                "source" character varying(16) NOT NULL DEFAULT 'manual',
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "FK_assistant_memory_entries_assistant" FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE CASCADE ON UPDATE NO ACTION
            )
        `);
        await queryRunner.query(`CREATE INDEX "IDX_assistant_memory_entries_assistant_id" ON "assistant_memory_entries" ("assistant_id")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_assistant_memory_entries_assistant_id"`);
        await queryRunner.query(`DROP TABLE "assistant_memory_entries"`);
    }
}

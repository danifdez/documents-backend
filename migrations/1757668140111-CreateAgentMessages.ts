import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgentMessages1757668140111 implements MigrationInterface {
    name = 'CreateAgentMessages1757668140111'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "agent_messages" (
                "id" SERIAL PRIMARY KEY,
                "agent_id" integer NOT NULL,
                "role" character varying(16) NOT NULL,
                "content" text NOT NULL,
                "job_id" integer,
                "error" text,
                "event" jsonb,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "FK_agent_messages_agent" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE NO ACTION
            )
        `);
        await queryRunner.query(`CREATE INDEX "IDX_agent_messages_agent_id" ON "agent_messages" ("agent_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_agent_messages_job_id" ON "agent_messages" ("job_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_agent_messages_agent_id_created_at" ON "agent_messages" ("agent_id", "created_at")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_agent_messages_agent_id_created_at"`);
        await queryRunner.query(`DROP INDEX "IDX_agent_messages_job_id"`);
        await queryRunner.query(`DROP INDEX "IDX_agent_messages_agent_id"`);
        await queryRunner.query(`DROP TABLE "agent_messages"`);
    }
}

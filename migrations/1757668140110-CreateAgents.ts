import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgents1757668140110 implements MigrationInterface {
    name = 'CreateAgents1757668140110'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "agents" (
                "id" SERIAL PRIMARY KEY,
                "name" character varying(100) NOT NULL,
                "system_prompt" text,
                "folder_scope" character varying(500),
                "icon" character varying(16),
                "sub" character varying(300),
                "pinned" boolean NOT NULL DEFAULT false,
                "last_seen_at" TIMESTAMP,
                "expires_at" TIMESTAMP,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now()
            )
        `);
        await queryRunner.query(`CREATE INDEX "IDX_agents_pinned_last_seen_at" ON "agents" ("pinned", "last_seen_at")`);
        await queryRunner.query(`CREATE INDEX "IDX_agents_expires_at" ON "agents" ("expires_at")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_agents_expires_at"`);
        await queryRunner.query(`DROP INDEX "IDX_agents_pinned_last_seen_at"`);
        await queryRunner.query(`DROP TABLE "agents"`);
    }
}

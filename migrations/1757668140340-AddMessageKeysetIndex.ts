import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMessageKeysetIndex1757668140340 implements MigrationInterface {
    name = 'AddMessageKeysetIndex1757668140340'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Support keyset pagination: WHERE owner_id = ? AND id < ? ORDER BY id DESC.
        await queryRunner.query(`CREATE INDEX "IDX_assistant_messages_assistant_id_id" ON "assistant_messages" ("assistant_id", "id")`);
        await queryRunner.query(`CREATE INDEX "IDX_agent_messages_agent_id_id" ON "agent_messages" ("agent_id", "id")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_agent_messages_agent_id_id"`);
        await queryRunner.query(`DROP INDEX "IDX_assistant_messages_assistant_id_id"`);
    }
}

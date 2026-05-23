import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drop legacy "helpers" rows from `assistants` — they were AssistantEntity with
 * isSystem=false in the previous model. Those are
 * Agent entities living in the `agents` table. No real data to preserve
 * (memory: "documents-dev nunca se ha usado en real").
 *
 * The `isSystem` column is kept and from now on marks ONLY the personal
 * assistant (one per user, seeded at bootstrap, protected from deletion).
 */
export class DropLegacyAssistantHelpers1757668140112 implements MigrationInterface {
    name = 'DropLegacyAssistantHelpers1757668140112'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Messages cascade-delete via FK; explicit DELETE is unnecessary but
        // kept for documentation clarity if FK is dropped in the future.
        await queryRunner.query(
            `DELETE FROM "assistant_messages" WHERE "assistant_id" IN (SELECT "id" FROM "assistants" WHERE "is_system" = false)`,
        );
        await queryRunner.query(
            `DELETE FROM "assistants" WHERE "is_system" = false`,
        );
    }

    public async down(_queryRunner: QueryRunner): Promise<void> {
        // No rollback — there was no real data. A `down` cannot resurrect what
        // was logically reassigned to a different table.
    }
}

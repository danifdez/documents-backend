import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Convert `indexed_files.assistant_id` (FK to `assistants.id`) into a polymorphic
 * `(owner_type, owner_id)` pair. `owner_type` is one of:
 *   - 'main-assistant' → owner_id references assistants.id (currently only the
 *     personal assistant with is_system=true).
 *   - 'agent'          → owner_id references agents.id.
 *
 * The FK is removed. Cascade is replicated explicitly in the service layer
 * (`IndexedFileService.clearAllForOwner` is called from `AgentService.remove`
 * and `AgentExpirationService` cron).
 */
export class IndexedFileToPolymorphicOwner1757668140120 implements MigrationInterface {
    name = 'IndexedFileToPolymorphicOwner1757668140120'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "indexed_files" ADD COLUMN "owner_type" character varying(20)`,
        );
        await queryRunner.query(
            `ALTER TABLE "indexed_files" ADD COLUMN "owner_id" integer`,
        );

        // Backfill: all existing rows belong to the personal assistant.
        await queryRunner.query(
            `UPDATE "indexed_files" SET "owner_type" = 'main-assistant', "owner_id" = "assistant_id"`,
        );

        await queryRunner.query(
            `ALTER TABLE "indexed_files" ALTER COLUMN "owner_type" SET NOT NULL`,
        );
        await queryRunner.query(
            `ALTER TABLE "indexed_files" ALTER COLUMN "owner_id" SET NOT NULL`,
        );

        // Drop FK + old assistant_id column and its indexes/constraints.
        await queryRunner.query(
            `ALTER TABLE "indexed_files" DROP CONSTRAINT "FK_indexed_files_assistant"`,
        );
        await queryRunner.query(
            `ALTER TABLE "indexed_files" DROP CONSTRAINT "UQ_indexed_files_assistant_filename"`,
        );
        await queryRunner.query(
            `DROP INDEX "IDX_indexed_files_assistant_id"`,
        );
        await queryRunner.query(
            `ALTER TABLE "indexed_files" DROP COLUMN "assistant_id"`,
        );

        // New indexes + uniqueness.
        await queryRunner.query(
            `CREATE INDEX "IDX_indexed_files_owner" ON "indexed_files" ("owner_type", "owner_id")`,
        );
        await queryRunner.query(
            `ALTER TABLE "indexed_files" ADD CONSTRAINT "UQ_indexed_files_owner_filename" UNIQUE ("owner_type", "owner_id", "filename")`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Drop the new constraints/indexes.
        await queryRunner.query(
            `ALTER TABLE "indexed_files" DROP CONSTRAINT "UQ_indexed_files_owner_filename"`,
        );
        await queryRunner.query(
            `DROP INDEX "IDX_indexed_files_owner"`,
        );

        // Add back assistant_id (nullable to allow backfill).
        await queryRunner.query(
            `ALTER TABLE "indexed_files" ADD COLUMN "assistant_id" integer`,
        );

        // Reassign main-assistant rows; drop agent rows (they didn't exist
        // before this migration).
        await queryRunner.query(
            `UPDATE "indexed_files" SET "assistant_id" = "owner_id" WHERE "owner_type" = 'main-assistant'`,
        );
        await queryRunner.query(
            `DELETE FROM "indexed_files" WHERE "owner_type" = 'agent'`,
        );

        await queryRunner.query(
            `ALTER TABLE "indexed_files" ALTER COLUMN "assistant_id" SET NOT NULL`,
        );

        await queryRunner.query(
            `ALTER TABLE "indexed_files" DROP COLUMN "owner_id"`,
        );
        await queryRunner.query(
            `ALTER TABLE "indexed_files" DROP COLUMN "owner_type"`,
        );

        // Restore FK + index + unique.
        await queryRunner.query(
            `CREATE INDEX "IDX_indexed_files_assistant_id" ON "indexed_files" ("assistant_id")`,
        );
        await queryRunner.query(
            `ALTER TABLE "indexed_files" ADD CONSTRAINT "UQ_indexed_files_assistant_filename" UNIQUE ("assistant_id", "filename")`,
        );
        await queryRunner.query(
            `ALTER TABLE "indexed_files" ADD CONSTRAINT "FK_indexed_files_assistant" FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE CASCADE`,
        );
    }
}

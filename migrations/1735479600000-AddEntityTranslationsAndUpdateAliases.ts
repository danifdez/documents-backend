import { MigrationInterface, QueryRunner } from "typeorm";

export class AddEntityTranslationsAndUpdateAliases1735479600000 implements MigrationInterface {
    name = 'AddEntityTranslationsAndUpdateAliases1735479600000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Add translations column
        await queryRunner.query(`ALTER TABLE "entities" ADD "translations" jsonb`);

        // Create a backup of existing aliases in old format
        await queryRunner.query(`ALTER TABLE "entities" ADD "aliases_backup" jsonb`);
        await queryRunner.query(`UPDATE "entities" SET "aliases_backup" = "aliases" WHERE "aliases" IS NOT NULL`);

        // Transform existing string array aliases to new locale-based format
        // Assume existing data is in English (en) by default
        await queryRunner.query(`
            UPDATE "entities" 
            SET "aliases" = (
                SELECT jsonb_agg(
                    jsonb_build_object('locale', 'en', 'value', alias_value)
                )
                FROM jsonb_array_elements_text("aliases") as alias_value
            )
            WHERE "aliases" IS NOT NULL AND jsonb_typeof("aliases") = 'array'
        `);

        // Add comment to document the schema change
        await queryRunner.query(`COMMENT ON COLUMN "entities"."translations" IS 'JSONB object containing translations by locale code: {"en": "Name", "es": "Nombre"}'`);
        await queryRunner.query(`COMMENT ON COLUMN "entities"."aliases" IS 'JSONB array of alias objects with locale: [{"locale": "en", "value": "Alias"}]'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Restore original aliases format from backup
        await queryRunner.query(`UPDATE "entities" SET "aliases" = "aliases_backup" WHERE "aliases_backup" IS NOT NULL`);

        // Remove new columns
        await queryRunner.query(`ALTER TABLE "entities" DROP COLUMN "translations"`);
        await queryRunner.query(`ALTER TABLE "entities" DROP COLUMN "aliases_backup"`);

        // Remove comments
        await queryRunner.query(`COMMENT ON COLUMN "entities"."aliases" IS NULL`);
    }
}
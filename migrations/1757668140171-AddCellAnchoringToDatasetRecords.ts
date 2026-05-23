import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCellAnchoringToDatasetRecords1757668140171 implements MigrationInterface {
  name = 'AddCellAnchoringToDatasetRecords1757668140171';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "dataset_records" ADD COLUMN "cell_metadata" JSONB NOT NULL DEFAULT '{}'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "dataset_records" ADD COLUMN "source_resource_id" INTEGER DEFAULT NULL REFERENCES "resources"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "dataset_records" ADD COLUMN "extraction_status" VARCHAR(16) NOT NULL DEFAULT 'extracted'`,
    );
    await queryRunner.query(
      `ALTER TABLE "dataset_records" ADD COLUMN "extraction_error" TEXT DEFAULT NULL`,
    );
    // Partial unique index: only one extracted row per (dataset, source_resource).
    // NULL source_resource_id (manual / legacy rows) is exempted from the uniqueness check.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uniq_dataset_records_dataset_source"
         ON "dataset_records" ("dataset_id", "source_resource_id")
         WHERE "source_resource_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "uniq_dataset_records_dataset_source"`);
    await queryRunner.query(`ALTER TABLE "dataset_records" DROP COLUMN "extraction_error"`);
    await queryRunner.query(`ALTER TABLE "dataset_records" DROP COLUMN "extraction_status"`);
    await queryRunner.query(`ALTER TABLE "dataset_records" DROP COLUMN "source_resource_id"`);
    await queryRunner.query(`ALTER TABLE "dataset_records" DROP COLUMN "cell_metadata"`);
  }
}

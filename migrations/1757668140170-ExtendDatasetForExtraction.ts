import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExtendDatasetForExtraction1757668140170 implements MigrationInterface {
  name = 'ExtendDatasetForExtraction1757668140170';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "datasets" ADD COLUMN "source_mode" VARCHAR(32) NOT NULL DEFAULT 'manual'`,
    );
    await queryRunner.query(
      `ALTER TABLE "datasets" ADD COLUMN "source_config" JSONB NOT NULL DEFAULT '{}'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "datasets" ADD COLUMN "extraction_config" JSONB DEFAULT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "datasets" DROP COLUMN "extraction_config"`);
    await queryRunner.query(`ALTER TABLE "datasets" DROP COLUMN "source_config"`);
    await queryRunner.query(`ALTER TABLE "datasets" DROP COLUMN "source_mode"`);
  }
}

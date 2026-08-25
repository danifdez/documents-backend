import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropObsoleteResourceDateResolutionFields1757668140480 implements MigrationInterface {
  name = 'DropObsoleteResourceDateResolutionFields1757668140480';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      [
        'ALTER TABLE "resource_dates"',
        'DROP COLUMN "resolver",',
        'DROP COLUMN "is_relative",',
        'DROP COLUMN "anchor_date_used"',
      ].join(' '),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      [
        'ALTER TABLE "resource_dates"',
        'ADD "resolver" character varying(16) NOT NULL',
        "DEFAULT 'unresolved',",
        'ADD "is_relative" boolean NOT NULL DEFAULT false,',
        'ADD "anchor_date_used" date',
      ].join(' '),
    );
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAnnotationAnchors1789600002000 implements MigrationInterface {
  name = 'AddAnnotationAnchors1789600002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "marks" ADD "prefix" text`);
    await queryRunner.query(`ALTER TABLE "marks" ADD "suffix" text`);
    await queryRunner.query(`ALTER TABLE "marks" ADD "position" integer`);
    await queryRunner.query(`ALTER TABLE "comments" ADD "quote" text`);
    await queryRunner.query(`ALTER TABLE "comments" ADD "prefix" text`);
    await queryRunner.query(`ALTER TABLE "comments" ADD "suffix" text`);
    await queryRunner.query(`ALTER TABLE "comments" ADD "position" integer`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "comments" DROP COLUMN "position"`);
    await queryRunner.query(`ALTER TABLE "comments" DROP COLUMN "suffix"`);
    await queryRunner.query(`ALTER TABLE "comments" DROP COLUMN "prefix"`);
    await queryRunner.query(`ALTER TABLE "comments" DROP COLUMN "quote"`);
    await queryRunner.query(`ALTER TABLE "marks" DROP COLUMN "position"`);
    await queryRunner.query(`ALTER TABLE "marks" DROP COLUMN "suffix"`);
    await queryRunner.query(`ALTER TABLE "marks" DROP COLUMN "prefix"`);
  }
}

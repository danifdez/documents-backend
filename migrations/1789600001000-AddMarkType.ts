import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMarkType1789600001000 implements MigrationInterface {
  name = 'AddMarkType1789600001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "marks" ADD "type" character varying(16) NOT NULL DEFAULT 'highlight'`,
    );
    await queryRunner.query(
      `ALTER TABLE "marks" ADD CONSTRAINT "CHK_marks_type" CHECK ("type" IN ('idea', 'important', 'review', 'highlight'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "marks" DROP CONSTRAINT "CHK_marks_type"`,
    );
    await queryRunner.query(`ALTER TABLE "marks" DROP COLUMN "type"`);
  }
}

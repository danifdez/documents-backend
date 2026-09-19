import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateReadingPoints1789700000000 implements MigrationInterface {
  name = 'CreateReadingPoints1789700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "reading_points" ("id" SERIAL NOT NULL, "kind" character varying(16) NOT NULL DEFAULT 'section', "label" text, "fragmentId" text, "exact" text, "prefix" text, "suffix" text, "position" integer NOT NULL DEFAULT 0, "ratio" double precision NOT NULL DEFAULT 0, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "docId" integer, "resourceId" integer, CONSTRAINT "PK_reading_points" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "reading_points" ADD CONSTRAINT "FK_reading_points_docId" FOREIGN KEY ("docId") REFERENCES "docs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "reading_points" ADD CONSTRAINT "FK_reading_points_resourceId" FOREIGN KEY ("resourceId") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "reading_points" ADD CONSTRAINT "CHK_reading_points_doc_or_resource" CHECK (("docId" IS NOT NULL) OR ("resourceId" IS NOT NULL))`,
    );
    await queryRunner.query(
      `ALTER TABLE "reading_points" ADD CONSTRAINT "CHK_reading_points_kind" CHECK ("kind" IN ('reading', 'section'))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_reading_points_docId" ON "reading_points" ("docId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_reading_points_resourceId" ON "reading_points" ("resourceId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_reading_points_doc_reading" ON "reading_points" ("docId") WHERE "kind" = 'reading' AND "docId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_reading_points_resource_reading" ON "reading_points" ("resourceId") WHERE "kind" = 'reading' AND "resourceId" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_reading_points_resource_reading"`);
    await queryRunner.query(`DROP INDEX "UQ_reading_points_doc_reading"`);
    await queryRunner.query(`DROP INDEX "IDX_reading_points_resourceId"`);
    await queryRunner.query(`DROP INDEX "IDX_reading_points_docId"`);
    await queryRunner.query(
      `ALTER TABLE "reading_points" DROP CONSTRAINT "CHK_reading_points_kind"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reading_points" DROP CONSTRAINT "CHK_reading_points_doc_or_resource"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reading_points" DROP CONSTRAINT "FK_reading_points_resourceId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reading_points" DROP CONSTRAINT "FK_reading_points_docId"`,
    );
    await queryRunner.query(`DROP TABLE "reading_points"`);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDatasets1757668140165 implements MigrationInterface {
  name = 'CreateDatasets1757668140165';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "datasets" (
        "id" SERIAL PRIMARY KEY,
        "name" varchar NOT NULL,
        "description" text,
        "project_id" integer,
        "schema" jsonb DEFAULT '[]',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "FK_datasets_project"
          FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "dataset_records" (
        "id" SERIAL PRIMARY KEY,
        "dataset_id" integer NOT NULL,
        "data" jsonb DEFAULT '{}',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "FK_dataset_records_dataset"
          FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_dataset_records_dataset_id" ON "dataset_records" ("dataset_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_dataset_records_dataset_id"`);
    await queryRunner.query(`DROP TABLE "dataset_records"`);
    await queryRunner.query(`DROP TABLE "datasets"`);
  }
}

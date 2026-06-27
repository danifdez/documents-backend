import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDatasets1757668140240 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "datasets" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, "description" text, "project_id" integer, "schema" jsonb DEFAULT '[]', "source_mode" character varying(32) NOT NULL DEFAULT 'manual', "source_config" jsonb NOT NULL DEFAULT '{}'::jsonb, "extraction_config" jsonb DEFAULT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_datasets" PRIMARY KEY ("id"))`);
    await queryRunner.query(`ALTER TABLE "datasets" ADD CONSTRAINT "FK_datasets_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);

    // ── Dataset Records ──
    await queryRunner.query(`CREATE TABLE "dataset_records" ("id" SERIAL NOT NULL, "dataset_id" integer NOT NULL, "data" jsonb DEFAULT '{}', "cell_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb, "source_resource_id" integer DEFAULT NULL, "extraction_status" character varying(16) NOT NULL DEFAULT 'extracted', "extraction_error" text DEFAULT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_dataset_records" PRIMARY KEY ("id"))`);
    await queryRunner.query(`ALTER TABLE "dataset_records" ADD CONSTRAINT "FK_dataset_records_dataset" FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "dataset_records" ADD CONSTRAINT "FK_dataset_records_source_resource" FOREIGN KEY ("source_resource_id") REFERENCES "resources"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    await queryRunner.query(`CREATE INDEX "IDX_dataset_records_dataset_id" ON "dataset_records" ("dataset_id")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "uniq_dataset_records_dataset_source" ON "dataset_records" ("dataset_id", "source_resource_id") WHERE "source_resource_id" IS NOT NULL`);

    // ── Dataset Relations ──
    await queryRunner.query(`CREATE TABLE "dataset_relations" ("id" SERIAL NOT NULL, "name" character varying, "source_dataset_id" integer NOT NULL, "target_dataset_id" integer NOT NULL, "relation_type" character varying NOT NULL, "created_at" TIMESTAMP DEFAULT now(), CONSTRAINT "PK_dataset_relations" PRIMARY KEY ("id"))`);
    await queryRunner.query(`ALTER TABLE "dataset_relations" ADD CONSTRAINT "FK_dataset_relations_source" FOREIGN KEY ("source_dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "dataset_relations" ADD CONSTRAINT "FK_dataset_relations_target" FOREIGN KEY ("target_dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);

    // ── Dataset Record Links ──
    await queryRunner.query(`CREATE TABLE "dataset_record_links" ("id" SERIAL NOT NULL, "relation_id" integer NOT NULL, "source_record_id" integer NOT NULL, "target_record_id" integer NOT NULL, CONSTRAINT "PK_dataset_record_links" PRIMARY KEY ("id"))`);
    await queryRunner.query(`ALTER TABLE "dataset_record_links" ADD CONSTRAINT "FK_record_links_relation" FOREIGN KEY ("relation_id") REFERENCES "dataset_relations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "dataset_record_links" ADD CONSTRAINT "FK_record_links_source" FOREIGN KEY ("source_record_id") REFERENCES "dataset_records"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "dataset_record_links" ADD CONSTRAINT "FK_record_links_target" FOREIGN KEY ("target_record_id") REFERENCES "dataset_records"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "dataset_record_links" ADD CONSTRAINT "UQ_record_links_unique" UNIQUE ("relation_id", "source_record_id", "target_record_id")`);

    // ── Dataset Charts ──
    await queryRunner.query(`CREATE TABLE "dataset_charts" ("id" SERIAL NOT NULL, "dataset_id" integer NOT NULL, "name" character varying NOT NULL, "config" jsonb DEFAULT '{}', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_dataset_charts" PRIMARY KEY ("id"))`);
    await queryRunner.query(`ALTER TABLE "dataset_charts" ADD CONSTRAINT "FK_dataset_charts_dataset" FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    await queryRunner.query(`CREATE INDEX "IDX_dataset_charts_dataset_id" ON "dataset_charts" ("dataset_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "dataset_charts"`);
    await queryRunner.query(`DROP TABLE "dataset_record_links"`);
    await queryRunner.query(`DROP TABLE "dataset_relations"`);
    await queryRunner.query(`DROP TABLE "dataset_records"`);
    await queryRunner.query(`DROP TABLE "datasets"`);
  }
}

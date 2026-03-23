import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDatasets1757668140019 implements MigrationInterface {
    name = 'CreateDatasets1757668140019'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "datasets" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, "description" text, "project_id" integer, "schema" jsonb NOT NULL DEFAULT '[]', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_datasets_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "datasets" ADD CONSTRAINT "FK_datasets_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);

        await queryRunner.query(`CREATE TABLE "dataset_records" ("id" SERIAL NOT NULL, "dataset_id" integer NOT NULL, "data" jsonb NOT NULL DEFAULT '{}', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_dataset_records_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_dataset_records_dataset_id" ON "dataset_records" ("dataset_id")`);
        await queryRunner.query(`ALTER TABLE "dataset_records" ADD CONSTRAINT "FK_dataset_records_dataset" FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);

        await queryRunner.query(`CREATE TABLE "dataset_relations" ("id" SERIAL NOT NULL, "name" character varying, "source_dataset_id" integer NOT NULL, "target_dataset_id" integer NOT NULL, "relation_type" character varying NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_dataset_relations_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "dataset_relations" ADD CONSTRAINT "FK_dataset_relations_source" FOREIGN KEY ("source_dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dataset_relations" ADD CONSTRAINT "FK_dataset_relations_target" FOREIGN KEY ("target_dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);

        await queryRunner.query(`CREATE TABLE "dataset_record_links" ("id" SERIAL NOT NULL, "relation_id" integer NOT NULL, "source_record_id" integer NOT NULL, "target_record_id" integer NOT NULL, CONSTRAINT "PK_dataset_record_links_id" PRIMARY KEY ("id"), CONSTRAINT "UQ_dataset_record_links" UNIQUE ("relation_id", "source_record_id", "target_record_id"))`);
        await queryRunner.query(`ALTER TABLE "dataset_record_links" ADD CONSTRAINT "FK_record_links_relation" FOREIGN KEY ("relation_id") REFERENCES "dataset_relations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dataset_record_links" ADD CONSTRAINT "FK_record_links_source" FOREIGN KEY ("source_record_id") REFERENCES "dataset_records"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dataset_record_links" ADD CONSTRAINT "FK_record_links_target" FOREIGN KEY ("target_record_id") REFERENCES "dataset_records"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "dataset_record_links" DROP CONSTRAINT "FK_record_links_target"`);
        await queryRunner.query(`ALTER TABLE "dataset_record_links" DROP CONSTRAINT "FK_record_links_source"`);
        await queryRunner.query(`ALTER TABLE "dataset_record_links" DROP CONSTRAINT "FK_record_links_relation"`);
        await queryRunner.query(`DROP TABLE "dataset_record_links"`);

        await queryRunner.query(`ALTER TABLE "dataset_relations" DROP CONSTRAINT "FK_dataset_relations_target"`);
        await queryRunner.query(`ALTER TABLE "dataset_relations" DROP CONSTRAINT "FK_dataset_relations_source"`);
        await queryRunner.query(`DROP TABLE "dataset_relations"`);

        await queryRunner.query(`ALTER TABLE "dataset_records" DROP CONSTRAINT "FK_dataset_records_dataset"`);
        await queryRunner.query(`DROP INDEX "IDX_dataset_records_dataset_id"`);
        await queryRunner.query(`DROP TABLE "dataset_records"`);

        await queryRunner.query(`ALTER TABLE "datasets" DROP CONSTRAINT "FK_datasets_project"`);
        await queryRunner.query(`DROP TABLE "datasets"`);
    }
}

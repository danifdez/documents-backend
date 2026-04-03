import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDataSources1757668140015 implements MigrationInterface {
    name = 'CreateDataSources1757668140015'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "data_sources" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, "description" text, "provider_type" character varying NOT NULL, "config" jsonb DEFAULT '{}', "credentials" jsonb, "schema_mapping" jsonb, "sync_schedule" character varying, "sync_strategy" character varying NOT NULL DEFAULT 'full', "incremental_key" character varying, "last_sync_at" TIMESTAMP, "last_sync_status" character varying, "last_sync_error" text, "last_sync_record_count" integer, "dataset_id" integer, "project_id" integer, "enabled" boolean NOT NULL DEFAULT true, "rate_limit_rpm" integer, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_data_sources" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_data_sources_provider_type" ON "data_sources" ("provider_type")`);
        await queryRunner.query(`CREATE INDEX "IDX_data_sources_dataset_id" ON "data_sources" ("dataset_id")`);
        await queryRunner.query(`ALTER TABLE "data_sources" ADD CONSTRAINT "FK_data_sources_dataset" FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "data_sources" ADD CONSTRAINT "FK_data_sources_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);

        await queryRunner.query(`CREATE TABLE "data_source_sync_logs" ("id" SERIAL NOT NULL, "data_source_id" integer NOT NULL, "status" character varying NOT NULL, "started_at" TIMESTAMP NOT NULL, "finished_at" TIMESTAMP, "records_fetched" integer NOT NULL DEFAULT 0, "records_created" integer NOT NULL DEFAULT 0, "records_updated" integer NOT NULL DEFAULT 0, "error_message" text, CONSTRAINT "PK_data_source_sync_logs" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_data_source_sync_logs_data_source_id" ON "data_source_sync_logs" ("data_source_id")`);
        await queryRunner.query(`ALTER TABLE "data_source_sync_logs" ADD CONSTRAINT "FK_data_source_sync_logs_data_source" FOREIGN KEY ("data_source_id") REFERENCES "data_sources"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "data_source_sync_logs" DROP CONSTRAINT "FK_data_source_sync_logs_data_source"`);
        await queryRunner.query(`DROP INDEX "IDX_data_source_sync_logs_data_source_id"`);
        await queryRunner.query(`DROP TABLE "data_source_sync_logs"`);
        await queryRunner.query(`ALTER TABLE "data_sources" DROP CONSTRAINT "FK_data_sources_project"`);
        await queryRunner.query(`ALTER TABLE "data_sources" DROP CONSTRAINT "FK_data_sources_dataset"`);
        await queryRunner.query(`DROP INDEX "IDX_data_sources_dataset_id"`);
        await queryRunner.query(`DROP INDEX "IDX_data_sources_provider_type"`);
        await queryRunner.query(`DROP TABLE "data_sources"`);
    }
}

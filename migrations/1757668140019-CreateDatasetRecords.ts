import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDatasetRecords1757668140019 implements MigrationInterface {
    name = 'CreateDatasetRecords1757668140019'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "dataset_records" ("id" SERIAL NOT NULL, "data" jsonb NOT NULL DEFAULT '{}', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "dataset_id" integer NOT NULL, CONSTRAINT "PK_dataset_records" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "dataset_records" ADD CONSTRAINT "FK_dataset_records_dataset" FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "dataset_records" DROP CONSTRAINT "FK_dataset_records_dataset"`);
        await queryRunner.query(`DROP TABLE "dataset_records"`);
    }
}

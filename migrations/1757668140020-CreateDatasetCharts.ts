import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDatasetCharts1757668140020 implements MigrationInterface {
    name = 'CreateDatasetCharts1757668140020'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "dataset_charts" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, "config" jsonb NOT NULL DEFAULT '{}', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "dataset_id" integer NOT NULL, CONSTRAINT "PK_dataset_charts" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "dataset_charts" ADD CONSTRAINT "FK_dataset_charts_dataset" FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "dataset_charts" DROP CONSTRAINT "FK_dataset_charts_dataset"`);
        await queryRunner.query(`DROP TABLE "dataset_charts"`);
    }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDatasetRecordLinks1757668140022 implements MigrationInterface {
    name = 'CreateDatasetRecordLinks1757668140022'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "dataset_record_links" ("id" SERIAL NOT NULL, "relation_id" integer NOT NULL, "source_record_id" integer NOT NULL, "target_record_id" integer NOT NULL, CONSTRAINT "UQ_dataset_record_links" UNIQUE ("relation_id", "source_record_id", "target_record_id"), CONSTRAINT "PK_dataset_record_links" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "dataset_record_links" ADD CONSTRAINT "FK_dataset_record_links_relation" FOREIGN KEY ("relation_id") REFERENCES "dataset_relations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dataset_record_links" ADD CONSTRAINT "FK_dataset_record_links_source" FOREIGN KEY ("source_record_id") REFERENCES "dataset_records"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dataset_record_links" ADD CONSTRAINT "FK_dataset_record_links_target" FOREIGN KEY ("target_record_id") REFERENCES "dataset_records"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "dataset_record_links" DROP CONSTRAINT "FK_dataset_record_links_target"`);
        await queryRunner.query(`ALTER TABLE "dataset_record_links" DROP CONSTRAINT "FK_dataset_record_links_source"`);
        await queryRunner.query(`ALTER TABLE "dataset_record_links" DROP CONSTRAINT "FK_dataset_record_links_relation"`);
        await queryRunner.query(`DROP TABLE "dataset_record_links"`);
    }
}

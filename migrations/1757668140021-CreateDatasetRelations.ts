import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDatasetRelations1757668140021 implements MigrationInterface {
    name = 'CreateDatasetRelations1757668140021'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "dataset_relations" ("id" SERIAL NOT NULL, "name" character varying, "relation_type" character varying NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "source_dataset_id" integer NOT NULL, "target_dataset_id" integer NOT NULL, CONSTRAINT "PK_dataset_relations" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "dataset_relations" ADD CONSTRAINT "FK_dataset_relations_source" FOREIGN KEY ("source_dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dataset_relations" ADD CONSTRAINT "FK_dataset_relations_target" FOREIGN KEY ("target_dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "dataset_relations" DROP CONSTRAINT "FK_dataset_relations_target"`);
        await queryRunner.query(`ALTER TABLE "dataset_relations" DROP CONSTRAINT "FK_dataset_relations_source"`);
        await queryRunner.query(`DROP TABLE "dataset_relations"`);
    }
}

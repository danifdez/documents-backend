import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDatasets1757668140018 implements MigrationInterface {
    name = 'CreateDatasets1757668140018'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "datasets" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, "description" text, "schema" jsonb NOT NULL DEFAULT '[]', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "project_id" integer, CONSTRAINT "PK_datasets" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "datasets" ADD CONSTRAINT "FK_datasets_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "datasets" DROP CONSTRAINT "FK_datasets_project"`);
        await queryRunner.query(`DROP TABLE "datasets"`);
    }
}

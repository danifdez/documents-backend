import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateResourceTypes1757668140088 implements MigrationInterface {
    name = 'CreateResourceTypes1757668140088'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "resource_types" ("id" SERIAL NOT NULL, "abbreviation" character varying NOT NULL, "name" character varying NOT NULL, "description" character varying, "example" character varying, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_d3bca389a6c56e445c7487b245e" PRIMARY KEY ("id"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "resource_types"`);
    }

}

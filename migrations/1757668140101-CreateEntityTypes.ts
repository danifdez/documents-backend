import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateEntityTypes1757668140101 implements MigrationInterface {
    name = 'CreateEntityTypes1757668140101'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "entity_types" (
            "id" SERIAL NOT NULL, 
            "name" character varying NOT NULL, 
            "description" character varying, 
            "created_at" TIMESTAMP NOT NULL DEFAULT now(), 
            "updated_at" TIMESTAMP NOT NULL DEFAULT now(), 
            CONSTRAINT "PK_entity_types_id" PRIMARY KEY ("id")
        )`);

        // Create unique index on name
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_entity_types_name" ON "entity_types" ("name")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_entity_types_name"`);
        await queryRunner.query(`DROP TABLE "entity_types"`);
    }
}
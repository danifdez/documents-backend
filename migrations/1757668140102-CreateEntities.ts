import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateEntities1757668140102 implements MigrationInterface {
    name = 'CreateEntities1757668140102'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "entities" (
            "id" SERIAL NOT NULL, 
            "name" character varying NOT NULL, 
            "aliases" jsonb, 
            "entity_type_id" integer NOT NULL,
            "created_at" TIMESTAMP NOT NULL DEFAULT now(), 
            "updated_at" TIMESTAMP NOT NULL DEFAULT now(), 
            CONSTRAINT "PK_entities_id" PRIMARY KEY ("id")
        )`);

        // Create foreign key constraint to entity_types
        await queryRunner.query(`ALTER TABLE "entities" ADD CONSTRAINT "FK_entities_entity_type_id" FOREIGN KEY ("entity_type_id") REFERENCES "entity_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE`);

        // Create indexes for better performance
        await queryRunner.query(`CREATE INDEX "IDX_entities_name" ON "entities" ("name")`);
        await queryRunner.query(`CREATE INDEX "IDX_entities_entity_type_id" ON "entities" ("entity_type_id")`);

        // Create unique constraint on name and type combination
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_entities_name_type_unique" ON "entities" ("name", "entity_type_id")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_entities_name_type_unique"`);
        await queryRunner.query(`DROP INDEX "IDX_entities_entity_type_id"`);
        await queryRunner.query(`DROP INDEX "IDX_entities_name"`);
        await queryRunner.query(`ALTER TABLE "entities" DROP CONSTRAINT "FK_entities_entity_type_id"`);
        await queryRunner.query(`DROP TABLE "entities"`);
    }
}
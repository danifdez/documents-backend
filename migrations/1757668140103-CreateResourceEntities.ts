import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateResourceEntities1757668140103 implements MigrationInterface {
    name = 'CreateResourceEntities1757668140103'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "resource_entities" (
            "resource_id" integer NOT NULL, 
            "entity_id" integer NOT NULL,
            "created_at" TIMESTAMP NOT NULL DEFAULT now(),
            CONSTRAINT "PK_resource_entities" PRIMARY KEY ("resource_id", "entity_id")
        )`);

        // Create foreign key constraints
        await queryRunner.query(`ALTER TABLE "resource_entities" ADD CONSTRAINT "FK_resource_entities_entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "resource_entities" ADD CONSTRAINT "FK_resource_entities_resource_id" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE`);

        // Create indexes for better performance
        await queryRunner.query(`CREATE INDEX "IDX_resource_entities_resource_id" ON "resource_entities" ("resource_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_resource_entities_entity_id" ON "resource_entities" ("entity_id")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_resource_entities_entity_id"`);
        await queryRunner.query(`DROP INDEX "IDX_resource_entities_resource_id"`);
        await queryRunner.query(`ALTER TABLE "resource_entities" DROP CONSTRAINT "FK_resource_entities_resource_id"`);
        await queryRunner.query(`ALTER TABLE "resource_entities" DROP CONSTRAINT "FK_resource_entities_entity_id"`);
        await queryRunner.query(`DROP TABLE "resource_entities"`);
    }
}
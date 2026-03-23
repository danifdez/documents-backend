import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEntities1757668140021 implements MigrationInterface {
    name = 'CreateEntities1757668140021'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "entities" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, "description" text, "global" boolean NOT NULL DEFAULT false, "translations" jsonb, "aliases" jsonb, "entity_type_id" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_entities_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "entities" ADD CONSTRAINT "FK_entities_entity_type_id" FOREIGN KEY ("entity_type_id") REFERENCES "entity_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE`);
        await queryRunner.query(`CREATE INDEX "IDX_entities_name" ON "entities" ("name")`);
        await queryRunner.query(`CREATE INDEX "IDX_entities_entity_type_id" ON "entities" ("entity_type_id")`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_entities_name_type_unique" ON "entities" ("name", "entity_type_id")`);
        await queryRunner.query(`COMMENT ON COLUMN "entities"."description" IS 'Optional description of the entity'`);
        await queryRunner.query(`COMMENT ON COLUMN "entities"."global" IS 'Indicates if the entity is globally available across all projects'`);
        await queryRunner.query(`COMMENT ON COLUMN "entities"."translations" IS 'JSONB object containing translations by locale code: {"en": "Name", "es": "Nombre"}'`);
        await queryRunner.query(`COMMENT ON COLUMN "entities"."aliases" IS 'JSONB array of alias objects with locale: [{"locale": "en", "value": "Alias"}]'`);

        await queryRunner.query(`CREATE TABLE "resource_entities" ("resource_id" integer NOT NULL, "entity_id" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_resource_entities" PRIMARY KEY ("resource_id", "entity_id"))`);
        await queryRunner.query(`ALTER TABLE "resource_entities" ADD CONSTRAINT "FK_resource_entities_entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "resource_entities" ADD CONSTRAINT "FK_resource_entities_resource_id" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`CREATE INDEX "IDX_resource_entities_resource_id" ON "resource_entities" ("resource_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_resource_entities_entity_id" ON "resource_entities" ("entity_id")`);

        await queryRunner.query(`CREATE TABLE "entity_projects" ("entity_id" int NOT NULL, "project_id" int NOT NULL, "created_at" timestamp DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "PK_entity_projects" PRIMARY KEY ("entity_id", "project_id"))`);
        await queryRunner.query(`ALTER TABLE "entity_projects" ADD CONSTRAINT "FK_entity_projects_entity" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE`);
        await queryRunner.query(`ALTER TABLE "entity_projects" ADD CONSTRAINT "FK_entity_projects_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "entity_projects" DROP CONSTRAINT "FK_entity_projects_project"`);
        await queryRunner.query(`ALTER TABLE "entity_projects" DROP CONSTRAINT "FK_entity_projects_entity"`);
        await queryRunner.query(`DROP TABLE "entity_projects"`);

        await queryRunner.query(`DROP INDEX "IDX_resource_entities_entity_id"`);
        await queryRunner.query(`DROP INDEX "IDX_resource_entities_resource_id"`);
        await queryRunner.query(`ALTER TABLE "resource_entities" DROP CONSTRAINT "FK_resource_entities_resource_id"`);
        await queryRunner.query(`ALTER TABLE "resource_entities" DROP CONSTRAINT "FK_resource_entities_entity_id"`);
        await queryRunner.query(`DROP TABLE "resource_entities"`);

        await queryRunner.query(`DROP INDEX "IDX_entities_name_type_unique"`);
        await queryRunner.query(`DROP INDEX "IDX_entities_entity_type_id"`);
        await queryRunner.query(`DROP INDEX "IDX_entities_name"`);
        await queryRunner.query(`ALTER TABLE "entities" DROP CONSTRAINT "FK_entities_entity_type_id"`);
        await queryRunner.query(`DROP TABLE "entities"`);
    }
}

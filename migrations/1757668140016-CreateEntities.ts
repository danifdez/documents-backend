import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEntities1757668140016 implements MigrationInterface {
    name = 'CreateEntities1757668140016'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "entities" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, "description" text, "global" boolean NOT NULL DEFAULT false, "translations" jsonb, "aliases" jsonb, "entity_type_id" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_entities" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "entities" ADD CONSTRAINT "FK_entities_entity_type" FOREIGN KEY ("entity_type_id") REFERENCES "entity_types"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);

        await queryRunner.query(`CREATE TABLE "entity_projects" ("entity_id" integer NOT NULL, "project_id" integer NOT NULL, CONSTRAINT "PK_entity_projects" PRIMARY KEY ("entity_id", "project_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_entity_projects_entity" ON "entity_projects" ("entity_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_entity_projects_project" ON "entity_projects" ("project_id")`);
        await queryRunner.query(`ALTER TABLE "entity_projects" ADD CONSTRAINT "FK_entity_projects_entity" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "entity_projects" ADD CONSTRAINT "FK_entity_projects_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE`);

        await queryRunner.query(`CREATE TABLE "resource_entities" ("resource_id" integer NOT NULL, "entity_id" integer NOT NULL, CONSTRAINT "PK_resource_entities" PRIMARY KEY ("resource_id", "entity_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_resource_entities_resource" ON "resource_entities" ("resource_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_resource_entities_entity" ON "resource_entities" ("entity_id")`);
        await queryRunner.query(`ALTER TABLE "resource_entities" ADD CONSTRAINT "FK_resource_entities_resource" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "resource_entities" ADD CONSTRAINT "FK_resource_entities_entity" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "resource_entities" DROP CONSTRAINT "FK_resource_entities_entity"`);
        await queryRunner.query(`ALTER TABLE "resource_entities" DROP CONSTRAINT "FK_resource_entities_resource"`);
        await queryRunner.query(`DROP INDEX "IDX_resource_entities_entity"`);
        await queryRunner.query(`DROP INDEX "IDX_resource_entities_resource"`);
        await queryRunner.query(`DROP TABLE "resource_entities"`);

        await queryRunner.query(`ALTER TABLE "entity_projects" DROP CONSTRAINT "FK_entity_projects_project"`);
        await queryRunner.query(`ALTER TABLE "entity_projects" DROP CONSTRAINT "FK_entity_projects_entity"`);
        await queryRunner.query(`DROP INDEX "IDX_entity_projects_project"`);
        await queryRunner.query(`DROP INDEX "IDX_entity_projects_entity"`);
        await queryRunner.query(`DROP TABLE "entity_projects"`);

        await queryRunner.query(`ALTER TABLE "entities" DROP CONSTRAINT "FK_entities_entity_type"`);
        await queryRunner.query(`DROP TABLE "entities"`);
    }
}

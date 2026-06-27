import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEntities1757668140210 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Entity Types ──
    await queryRunner.query(`CREATE TABLE "entity_types" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, "description" character varying, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_entity_types" PRIMARY KEY ("id"), CONSTRAINT "UQ_entity_types_name" UNIQUE ("name"))`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_entity_types_name" ON "entity_types" ("name")`);

    await queryRunner.query(`INSERT INTO "entity_types" ("name", "description") VALUES
      ('GEOPOLITICAL', 'Countries, cities, states'),
      ('LOCATION', 'Non-GPE locations, mountain ranges, bodies of water'),
      ('NATIONALITY', 'Nationalities or religious or political groups'),
      ('PERSON', 'People, including fictional'),
      ('ORGANIZATION', 'Companies, agencies, institutions'),
      ('EVENT', 'Named events: hurricanes, battles, wars, sports events'),
      ('FACILITY', 'Buildings, airports, highways, bridges'),
      ('PRODUCT', 'Objects, vehicles, foods (not services)'),
      ('WORK_OF_ART', 'Titles of books, songs, etc.'),
      ('LANGUAGE', 'Any named language'),
      ('LAW', 'Named documents made into laws')
      ON CONFLICT ("name") DO NOTHING`);

    // ── Entities ──
    await queryRunner.query(`CREATE TABLE "entities" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, "description" text, "global" boolean DEFAULT false, "translations" jsonb, "aliases" jsonb, "entity_type_id" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_entities" PRIMARY KEY ("id"))`);
    await queryRunner.query(`ALTER TABLE "entities" ADD CONSTRAINT "FK_entities_entity_type_id" FOREIGN KEY ("entity_type_id") REFERENCES "entity_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE`);
    await queryRunner.query(`CREATE INDEX "IDX_entities_name" ON "entities" ("name")`);
    await queryRunner.query(`CREATE INDEX "IDX_entities_entity_type_id" ON "entities" ("entity_type_id")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_entities_name_type_unique" ON "entities" ("name", "entity_type_id")`);
    await queryRunner.query(`COMMENT ON COLUMN "entities"."description" IS 'Optional description of the entity'`);
    await queryRunner.query(`COMMENT ON COLUMN "entities"."global" IS 'Whether this entity is global (cross-project)'`);
    await queryRunner.query(`COMMENT ON COLUMN "entities"."translations" IS 'JSON object with locale keys and translated names'`);
    await queryRunner.query(`COMMENT ON COLUMN "entities"."aliases" IS 'JSON array of alternative names or spellings'`);

    // ── Resource-Entities junction ──
    await queryRunner.query(`CREATE TABLE "resource_entities" ("resource_id" integer NOT NULL, "entity_id" integer NOT NULL, "created_at" TIMESTAMP DEFAULT now(), CONSTRAINT "PK_resource_entities" PRIMARY KEY ("resource_id", "entity_id"))`);
    await queryRunner.query(`ALTER TABLE "resource_entities" ADD CONSTRAINT "FK_resource_entities_resource_id" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
    await queryRunner.query(`ALTER TABLE "resource_entities" ADD CONSTRAINT "FK_resource_entities_entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
    await queryRunner.query(`CREATE INDEX "IDX_resource_entities_resource_id" ON "resource_entities" ("resource_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_resource_entities_entity_id" ON "resource_entities" ("entity_id")`);

    // ── Entity-Projects junction ──
    await queryRunner.query(`CREATE TABLE "entity_projects" ("entity_id" integer NOT NULL, "project_id" integer NOT NULL, "created_at" TIMESTAMP DEFAULT now(), CONSTRAINT "PK_entity_projects" PRIMARY KEY ("entity_id", "project_id"))`);
    await queryRunner.query(`ALTER TABLE "entity_projects" ADD CONSTRAINT "FK_entity_projects_entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
    await queryRunner.query(`ALTER TABLE "entity_projects" ADD CONSTRAINT "FK_entity_projects_project_id" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE`);

    // ── Pending Entities ──
    await queryRunner.query(`CREATE TABLE "pending_entities" ("id" SERIAL NOT NULL, "resource_id" integer NOT NULL, "name" character varying NOT NULL, "description" text, "translations" jsonb, "aliases" jsonb, "entity_type_id" integer, "language" character varying, "status" character varying DEFAULT 'pending', "merged_target_type" character varying, "merged_target_id" integer, "merged_at" TIMESTAMP, "scope" character varying DEFAULT 'document', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_pending_entities" PRIMARY KEY ("id"))`);
    await queryRunner.query(`COMMENT ON COLUMN "pending_entities"."description" IS 'Optional description'`);
    await queryRunner.query(`ALTER TABLE "pending_entities" ADD CONSTRAINT "FK_pending_entities_entity_type_id" FOREIGN KEY ("entity_type_id") REFERENCES "entity_types"("id") ON DELETE SET NULL ON UPDATE CASCADE`);
    await queryRunner.query(`ALTER TABLE "pending_entities" ADD CONSTRAINT "FK_pending_entities_resource_id" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
    await queryRunner.query(`CREATE INDEX "IDX_pending_entities_resource_id" ON "pending_entities" ("resource_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_pending_entities_name" ON "pending_entities" ("name")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "pending_entities"`);
    await queryRunner.query(`DROP TABLE "entity_projects"`);
    await queryRunner.query(`DROP TABLE "resource_entities"`);
    await queryRunner.query(`DROP TABLE "entities"`);
    await queryRunner.query(`DROP TABLE "entity_types"`);
  }
}

-- Feature: entities
-- Creates entity_types, entities, resource_entities, entity_projects, pending_entities

-- ── Entity Types ──
CREATE TABLE IF NOT EXISTS "entity_types" (
  "id" SERIAL PRIMARY KEY,
  "name" varchar NOT NULL UNIQUE,
  "description" varchar,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "IDX_entity_types_name" ON "entity_types" ("name");

-- Seed default entity types
INSERT INTO "entity_types" ("name", "description")
VALUES
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
ON CONFLICT ("name") DO NOTHING;

-- ── Entities ──
CREATE TABLE IF NOT EXISTS "entities" (
  "id" SERIAL PRIMARY KEY,
  "name" varchar NOT NULL,
  "description" text,
  "global" boolean DEFAULT false,
  "translations" jsonb,
  "aliases" jsonb,
  "entity_type_id" integer NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE "entities" ADD CONSTRAINT "FK_entities_entity_type_id"
    FOREIGN KEY ("entity_type_id") REFERENCES "entity_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "IDX_entities_name" ON "entities" ("name");
CREATE INDEX IF NOT EXISTS "IDX_entities_entity_type_id" ON "entities" ("entity_type_id");
CREATE UNIQUE INDEX IF NOT EXISTS "IDX_entities_name_type_unique" ON "entities" ("name", "entity_type_id");

COMMENT ON COLUMN "entities"."description" IS 'Optional description of the entity';
COMMENT ON COLUMN "entities"."global" IS 'Whether this entity is global (cross-project)';
COMMENT ON COLUMN "entities"."translations" IS 'JSON object with locale keys and translated names';
COMMENT ON COLUMN "entities"."aliases" IS 'JSON array of alternative names or spellings';

-- ── Resource-Entities junction ──
CREATE TABLE IF NOT EXISTS "resource_entities" (
  "resource_id" integer NOT NULL,
  "entity_id" integer NOT NULL,
  "created_at" TIMESTAMP DEFAULT now(),
  PRIMARY KEY ("resource_id", "entity_id")
);

DO $$ BEGIN
  ALTER TABLE "resource_entities" ADD CONSTRAINT "FK_resource_entities_resource_id"
    FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "resource_entities" ADD CONSTRAINT "FK_resource_entities_entity_id"
    FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "IDX_resource_entities_resource_id" ON "resource_entities" ("resource_id");
CREATE INDEX IF NOT EXISTS "IDX_resource_entities_entity_id" ON "resource_entities" ("entity_id");

-- ── Entity-Projects junction ──
CREATE TABLE IF NOT EXISTS "entity_projects" (
  "entity_id" integer NOT NULL,
  "project_id" integer NOT NULL,
  "created_at" TIMESTAMP DEFAULT now(),
  PRIMARY KEY ("entity_id", "project_id")
);

DO $$ BEGIN
  ALTER TABLE "entity_projects" ADD CONSTRAINT "FK_entity_projects_entity_id"
    FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "entity_projects" ADD CONSTRAINT "FK_entity_projects_project_id"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Pending Entities ──
CREATE TABLE IF NOT EXISTS "pending_entities" (
  "id" SERIAL PRIMARY KEY,
  "resource_id" integer NOT NULL,
  "name" varchar NOT NULL,
  "description" text,
  "translations" jsonb,
  "aliases" jsonb,
  "entity_type_id" integer,
  "language" varchar,
  "status" varchar DEFAULT 'pending',
  "merged_target_type" varchar,
  "merged_target_id" integer,
  "merged_at" TIMESTAMP,
  "scope" VARCHAR DEFAULT 'document',
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now()
);

COMMENT ON COLUMN "pending_entities"."description" IS 'Optional description';

DO $$ BEGIN
  ALTER TABLE "pending_entities" ADD CONSTRAINT "FK_pending_entities_entity_type_id"
    FOREIGN KEY ("entity_type_id") REFERENCES "entity_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "pending_entities" ADD CONSTRAINT "FK_pending_entities_resource_id"
    FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "IDX_pending_entities_resource_id" ON "pending_entities" ("resource_id");
CREATE INDEX IF NOT EXISTS "IDX_pending_entities_name" ON "pending_entities" ("name");

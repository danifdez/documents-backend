-- Feature: authors
-- Creates authors table and resource_authors junction

CREATE TABLE IF NOT EXISTS "authors" (
  "id" SERIAL PRIMARY KEY,
  "name" varchar NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "UQ_authors_name_lower" ON "authors" (LOWER("name"));
CREATE INDEX IF NOT EXISTS "IDX_authors_name" ON "authors" ("name");

-- ── Resource-Authors junction ──
CREATE TABLE IF NOT EXISTS "resource_authors" (
  "resource_id" integer NOT NULL,
  "author_id" integer NOT NULL,
  "created_at" TIMESTAMP DEFAULT now(),
  PRIMARY KEY ("resource_id", "author_id")
);

DO $$ BEGIN
  ALTER TABLE "resource_authors" ADD CONSTRAINT "FK_resource_authors_author_id"
    FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "resource_authors" ADD CONSTRAINT "FK_resource_authors_resource_id"
    FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "IDX_resource_authors_resource_id" ON "resource_authors" ("resource_id");
CREATE INDEX IF NOT EXISTS "IDX_resource_authors_author_id" ON "resource_authors" ("author_id");

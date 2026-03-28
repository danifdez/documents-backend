-- Feature: datasets
-- Creates datasets, dataset_records, dataset_relations, dataset_record_links

CREATE TABLE IF NOT EXISTS "datasets" (
  "id" SERIAL PRIMARY KEY,
  "name" varchar NOT NULL,
  "description" text,
  "project_id" integer,
  "schema" jsonb DEFAULT '[]',
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE "datasets" ADD CONSTRAINT "FK_datasets_project"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Dataset Records ──
CREATE TABLE IF NOT EXISTS "dataset_records" (
  "id" SERIAL PRIMARY KEY,
  "dataset_id" integer NOT NULL,
  "data" jsonb DEFAULT '{}',
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE "dataset_records" ADD CONSTRAINT "FK_dataset_records_dataset"
    FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "IDX_dataset_records_dataset_id" ON "dataset_records" ("dataset_id");

-- ── Dataset Relations ──
CREATE TABLE IF NOT EXISTS "dataset_relations" (
  "id" SERIAL PRIMARY KEY,
  "name" varchar,
  "source_dataset_id" integer NOT NULL,
  "target_dataset_id" integer NOT NULL,
  "relation_type" varchar NOT NULL,
  "created_at" TIMESTAMP DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE "dataset_relations" ADD CONSTRAINT "FK_dataset_relations_source"
    FOREIGN KEY ("source_dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "dataset_relations" ADD CONSTRAINT "FK_dataset_relations_target"
    FOREIGN KEY ("target_dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Dataset Record Links ──
CREATE TABLE IF NOT EXISTS "dataset_record_links" (
  "id" SERIAL PRIMARY KEY,
  "relation_id" integer NOT NULL,
  "source_record_id" integer NOT NULL,
  "target_record_id" integer NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "dataset_record_links" ADD CONSTRAINT "FK_record_links_relation"
    FOREIGN KEY ("relation_id") REFERENCES "dataset_relations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "dataset_record_links" ADD CONSTRAINT "FK_record_links_source"
    FOREIGN KEY ("source_record_id") REFERENCES "dataset_records"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "dataset_record_links" ADD CONSTRAINT "FK_record_links_target"
    FOREIGN KEY ("target_record_id") REFERENCES "dataset_records"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "dataset_record_links" ADD CONSTRAINT "UQ_record_links_unique"
    UNIQUE ("relation_id", "source_record_id", "target_record_id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

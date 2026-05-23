-- Feature: datasets
-- Creates datasets, dataset_records, dataset_relations, dataset_record_links

CREATE TABLE IF NOT EXISTS "datasets" (
    "id" SERIAL PRIMARY KEY,
    "name" varchar NOT NULL,
    "description" text,
    "project_id" integer,
    "schema" jsonb DEFAULT '[]',
    "source_mode" varchar(32) NOT NULL DEFAULT 'manual',
    "source_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "extraction_config" jsonb DEFAULT NULL,
    "created_at" TIMESTAMP NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMP NOT NULL DEFAULT now()
);

-- Re-entry guards for installs predating cambio-10 extraction extensions
DO $$ BEGIN
  ALTER TABLE "datasets" ADD COLUMN "source_mode" varchar(32) NOT NULL DEFAULT 'manual';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "datasets" ADD COLUMN "source_config" jsonb NOT NULL DEFAULT '{}'::jsonb;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "datasets" ADD COLUMN "extraction_config" jsonb DEFAULT NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

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
    "cell_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "source_resource_id" integer DEFAULT NULL,
    "extraction_status" varchar(16) NOT NULL DEFAULT 'extracted',
    "extraction_error" text DEFAULT NULL,
    "created_at" TIMESTAMP NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMP NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE "dataset_records" ADD CONSTRAINT "FK_dataset_records_dataset"
    FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Re-entry guards for installs predating
DO $$ BEGIN
  ALTER TABLE "dataset_records" ADD COLUMN "cell_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "dataset_records" ADD COLUMN "source_resource_id" integer DEFAULT NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "dataset_records" ADD COLUMN "extraction_status" varchar(16) NOT NULL DEFAULT 'extracted';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "dataset_records" ADD COLUMN "extraction_error" text DEFAULT NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "dataset_records" ADD CONSTRAINT "FK_dataset_records_source_resource"
    FOREIGN KEY ("source_resource_id") REFERENCES "resources"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "IDX_dataset_records_dataset_id" ON "dataset_records" ("dataset_id");

-- Only one extracted row per (dataset, source_resource). NULL source allows multiple manual rows.
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_dataset_records_dataset_source" ON "dataset_records" (
    "dataset_id",
    "source_resource_id"
)
WHERE
    "source_resource_id" IS NOT NULL;

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

-- ── Dataset Charts (saved chart configurations) ──
CREATE TABLE IF NOT EXISTS "dataset_charts" (
    "id" SERIAL PRIMARY KEY,
    "dataset_id" integer NOT NULL,
    "name" varchar NOT NULL,
    "config" jsonb DEFAULT '{}',
    "created_at" TIMESTAMP NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMP NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE "dataset_charts" ADD CONSTRAINT "FK_dataset_charts_dataset"
    FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "IDX_dataset_charts_dataset_id" ON "dataset_charts" ("dataset_id");
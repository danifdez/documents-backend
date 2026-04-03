-- Feature: data_sources
-- Creates data_sources and data_source_sync_logs tables

CREATE TABLE IF NOT EXISTS "data_sources" (
  "id" SERIAL PRIMARY KEY,
  "name" varchar NOT NULL,
  "description" text,
  "provider_type" varchar NOT NULL,
  "config" jsonb DEFAULT '{}',
  "credentials" jsonb,
  "schema_mapping" jsonb,
  "sync_schedule" varchar,
  "sync_strategy" varchar NOT NULL DEFAULT 'full',
  "incremental_key" varchar,
  "last_sync_at" TIMESTAMP,
  "last_sync_status" varchar,
  "last_sync_error" text,
  "last_sync_record_count" integer,
  "dataset_id" integer,
  "project_id" integer,
  "enabled" boolean NOT NULL DEFAULT true,
  "rate_limit_rpm" integer,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE "data_sources" ADD CONSTRAINT "FK_data_sources_dataset"
    FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "data_sources" ADD CONSTRAINT "FK_data_sources_project"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "IDX_data_sources_provider_type" ON "data_sources" ("provider_type");
CREATE INDEX IF NOT EXISTS "IDX_data_sources_dataset_id" ON "data_sources" ("dataset_id");

-- ── Sync Logs ──
CREATE TABLE IF NOT EXISTS "data_source_sync_logs" (
  "id" SERIAL PRIMARY KEY,
  "data_source_id" integer NOT NULL,
  "status" varchar NOT NULL,
  "started_at" TIMESTAMP NOT NULL,
  "finished_at" TIMESTAMP,
  "records_fetched" integer NOT NULL DEFAULT 0,
  "records_created" integer NOT NULL DEFAULT 0,
  "records_updated" integer NOT NULL DEFAULT 0,
  "error_message" text
);

DO $$ BEGIN
  ALTER TABLE "data_source_sync_logs" ADD CONSTRAINT "FK_data_source_sync_logs_data_source"
    FOREIGN KEY ("data_source_id") REFERENCES "data_sources"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "IDX_data_source_sync_logs_data_source_id" ON "data_source_sync_logs" ("data_source_id");

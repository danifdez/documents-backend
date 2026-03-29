-- Feature: timelines

CREATE TABLE IF NOT EXISTS "timelines" (
  "id" SERIAL PRIMARY KEY,
  "name" VARCHAR NOT NULL,
  "timeline_data" JSONB,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
  "projectId" INTEGER
);

ALTER TABLE "timelines" ADD COLUMN IF NOT EXISTS "epochs" JSONB;
ALTER TABLE "timelines" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "timelines" ADD COLUMN IF NOT EXISTS "sync_dataset_id" INTEGER;
ALTER TABLE "timelines" ADD COLUMN IF NOT EXISTS "sync_mapping" JSONB;
ALTER TABLE "timelines" ADD COLUMN IF NOT EXISTS "layout_type" VARCHAR NOT NULL DEFAULT 'horizontal';
ALTER TABLE "timelines" ADD COLUMN IF NOT EXISTS "axis_breaks" BOOLEAN NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE "timelines" ADD CONSTRAINT "FK_timelines_project"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

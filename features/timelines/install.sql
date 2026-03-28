-- Feature: timelines

CREATE TABLE IF NOT EXISTS "timelines" (
  "id" SERIAL PRIMARY KEY,
  "name" VARCHAR NOT NULL,
  "timeline_data" JSONB,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
  "projectId" INTEGER
);

DO $$ BEGIN
  ALTER TABLE "timelines" ADD CONSTRAINT "FK_timelines_project"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Feature: canvas

CREATE TABLE IF NOT EXISTS "canvases" (
  "id" SERIAL PRIMARY KEY,
  "name" varchar NOT NULL,
  "canvas_data" jsonb,
  "content" text,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
  "threadId" integer,
  "projectId" integer
);

DO $$ BEGIN
  ALTER TABLE "canvases" ADD CONSTRAINT "FK_canvases_thread"
    FOREIGN KEY ("threadId") REFERENCES "threads"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "canvases" ADD CONSTRAINT "FK_canvases_project"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

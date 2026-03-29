-- Feature: notes

CREATE TABLE IF NOT EXISTS "notes" (
  "id" SERIAL PRIMARY KEY,
  "title" varchar NOT NULL,
  "content" text,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
  "projectId" integer,
  "threadId" integer
);

DO $$ BEGIN
  ALTER TABLE "notes" ADD CONSTRAINT "FK_notes_project"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "notes" ADD CONSTRAINT "FK_notes_thread"
    FOREIGN KEY ("threadId") REFERENCES "threads"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Feature: tasks

CREATE TABLE IF NOT EXISTS "user_tasks" (
  "id" SERIAL PRIMARY KEY,
  "title" VARCHAR NOT NULL,
  "description" TEXT,
  "status" VARCHAR DEFAULT 'pending',
  "reminder_at" TIMESTAMPTZ,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
  "projectId" INTEGER
);

DO $$ BEGIN
  ALTER TABLE "user_tasks" ADD CONSTRAINT "FK_user_tasks_project"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Re-entry guard for installs predating this column
DO $$ BEGIN
  ALTER TABLE "user_tasks" ADD COLUMN "reminder_at" TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Partial index: scheduler only scans rows with reminder_at != NULL.
CREATE INDEX IF NOT EXISTS "idx_user_tasks_reminder_at"
  ON "user_tasks" ("reminder_at")
  WHERE "reminder_at" IS NOT NULL;

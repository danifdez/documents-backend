-- Feature: tasks

CREATE TABLE IF NOT EXISTS "user_tasks" (
  "id" SERIAL PRIMARY KEY,
  "title" VARCHAR NOT NULL,
  "description" TEXT,
  "status" VARCHAR DEFAULT 'pending',
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
  "projectId" INTEGER
);

DO $$ BEGIN
  ALTER TABLE "user_tasks" ADD CONSTRAINT "FK_user_tasks_project"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

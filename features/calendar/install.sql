-- Feature: calendar

CREATE TABLE IF NOT EXISTS "calendar_events" (
  "id" SERIAL PRIMARY KEY,
  "title" varchar NOT NULL,
  "description" text,
  "start_date" TIMESTAMP WITH TIME ZONE NOT NULL,
  "end_date" TIMESTAMP WITH TIME ZONE,
  "color" varchar DEFAULT '#3b82f6',
  "all_day" boolean DEFAULT false,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
  "projectId" integer
);

DO $$ BEGIN
  ALTER TABLE "calendar_events" ADD CONSTRAINT "FK_calendar_events_project"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

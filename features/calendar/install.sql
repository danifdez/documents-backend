-- Feature: calendar

CREATE TABLE IF NOT EXISTS "calendar_events" (
  "id" SERIAL PRIMARY KEY,
  "title" varchar NOT NULL,
  "description" text,
  "start_date" TIMESTAMP WITH TIME ZONE NOT NULL,
  "end_date" TIMESTAMP WITH TIME ZONE,
  "color" varchar DEFAULT '#3b82f6',
  "all_day" boolean DEFAULT false,
  "recurrence_rule" text,
  "alarm" jsonb,
  "track_completion" boolean NOT NULL DEFAULT false,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
  "projectId" integer
);

DO $$ BEGIN
  ALTER TABLE "calendar_events" ADD CONSTRAINT "FK_calendar_events_project"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Re-entry guards for installs predating these columns
DO $$ BEGIN
  ALTER TABLE "calendar_events" ADD COLUMN "recurrence_rule" text;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "calendar_events" ADD COLUMN "alarm" jsonb;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "calendar_events" ADD COLUMN "track_completion" boolean NOT NULL DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ── Event Occurrence Completion (per-occurrence completion tracking) ──
CREATE TABLE IF NOT EXISTS "event_occurrence_completion" (
  "id" SERIAL PRIMARY KEY,
  "event_id" integer NOT NULL REFERENCES "calendar_events"("id") ON DELETE CASCADE,
  "occurrence_date" TIMESTAMPTZ NOT NULL,
  "completed_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_event_occurrence"
  ON "event_occurrence_completion" ("event_id", "occurrence_date");

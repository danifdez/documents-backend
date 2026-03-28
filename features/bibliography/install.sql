-- Feature: bibliography

CREATE TABLE IF NOT EXISTS "bibliography_entries" (
  "id" SERIAL PRIMARY KEY,
  "entry_type" varchar DEFAULT 'misc',
  "cite_key" varchar,
  "title" varchar,
  "creators" json,
  "year" varchar,
  "journal" varchar,
  "booktitle" varchar,
  "volume" varchar,
  "number" varchar,
  "pages" varchar,
  "publisher" varchar,
  "place" varchar,
  "url" varchar,
  "doi" varchar,
  "isbn" varchar,
  "edition" varchar,
  "note" text,
  "extra_fields" json,
  "abstract" text,
  "access_date" varchar,
  "archive" varchar,
  "archive_location" varchar,
  "call_number" varchar,
  "short_title" varchar,
  "language" varchar,
  "rights" varchar,
  "extra" text,
  "conference_name" varchar,
  "website_title" varchar,
  "website_type" varchar,
  "thesis_type" varchar,
  "university" varchar,
  "institution" varchar,
  "series" varchar,
  "series_number" varchar,
  "number_of_volumes" varchar,
  "number_of_pages" varchar,
  "issn" varchar,
  "report_number" varchar,
  "report_type" varchar,
  "journal_abbreviation" varchar,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
  "projectId" integer,
  "sourceResourceId" integer
);

DO $$ BEGIN
  ALTER TABLE "bibliography_entries" ADD CONSTRAINT "FK_bibliography_entries_project"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "bibliography_entries" ADD CONSTRAINT "FK_bibliography_entries_resource"
    FOREIGN KEY ("sourceResourceId") REFERENCES "resources"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

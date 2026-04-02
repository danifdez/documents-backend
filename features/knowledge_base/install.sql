-- Feature: knowledge_base

CREATE TABLE IF NOT EXISTS "knowledge_entries" (
  "id" SERIAL PRIMARY KEY,
  "title" varchar NOT NULL,
  "content" text,
  "summary" text,
  "tags" jsonb,
  "is_definition" boolean NOT NULL DEFAULT false,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE "knowledge_entries" ADD COLUMN IF NOT EXISTS "is_definition" boolean NOT NULL DEFAULT false;
ALTER TABLE "knowledge_entries" ADD COLUMN IF NOT EXISTS "entity_id" integer;

DO $$ BEGIN
  ALTER TABLE "knowledge_entries" ADD CONSTRAINT "FK_knowledge_entries_entity"
    FOREIGN KEY ("entity_id") REFERENCES "entities"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

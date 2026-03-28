-- Feature: knowledge_base

CREATE TABLE IF NOT EXISTS "knowledge_entries" (
  "id" SERIAL PRIMARY KEY,
  "title" varchar NOT NULL,
  "content" text,
  "summary" text,
  "tags" jsonb,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now()
);

-- Feature: entities — uninstall
-- Drops pending_entities, resource_entities, entity_projects, entities, entity_types

DROP TABLE IF EXISTS "pending_entities" CASCADE;
DROP TABLE IF EXISTS "resource_entities" CASCADE;
DROP TABLE IF EXISTS "entity_projects" CASCADE;
DROP TABLE IF EXISTS "entities" CASCADE;
DROP TABLE IF EXISTS "entity_types" CASCADE;

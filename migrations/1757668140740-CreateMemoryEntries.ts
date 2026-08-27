import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMemoryEntries1757668140740 implements MigrationInterface {
  name = 'CreateMemoryEntries1757668140740';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "memory_entries" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "assistant_id" integer,
        "agent_id" integer,
        "name" varchar(120) NOT NULL,
        "type" varchar(16) NOT NULL,
        "body" text NOT NULL,
        "content_hash" varchar(71) NOT NULL,
        "source_kind" varchar(24) NOT NULL,
        "source_execution_id" uuid,
        "source_turn_id" uuid,
        "source_message_id" integer,
        "source_artifact_id" uuid,
        "source_artifact_revision" integer,
        "consent_status" varchar(16) NOT NULL,
        "consent_basis" varchar(32) NOT NULL,
        "consented_at" timestamptz NOT NULL,
        "data_classification" varchar(24) NOT NULL,
        "purpose" varchar(32) NOT NULL,
        "allowed_destinations" text[] NOT NULL DEFAULT '{documents,documents-models}',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_memory_entries" PRIMARY KEY ("id"),
        CONSTRAINT "FK_memory_entries_assistant" FOREIGN KEY ("assistant_id")
          REFERENCES "assistants"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_memory_entries_agent" FOREIGN KEY ("agent_id")
          REFERENCES "agents"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_memory_entries_source_execution" FOREIGN KEY ("source_execution_id")
          REFERENCES "executions"("execution_id") ON DELETE RESTRICT,
        CONSTRAINT "FK_memory_entries_source_turn" FOREIGN KEY ("source_turn_id")
          REFERENCES "conversation_turns"("turn_id") ON DELETE RESTRICT,
        CONSTRAINT "FK_memory_entries_source_artifact" FOREIGN KEY ("source_artifact_id")
          REFERENCES "execution_artifacts"("artifact_id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_memory_entries_owner" CHECK (
          ("assistant_id" IS NOT NULL)::integer + ("agent_id" IS NOT NULL)::integer = 1
        ),
        CONSTRAINT "CHK_memory_entries_type" CHECK (
          "type" IN ('fact', 'preference', 'episode')
        ),
        CONSTRAINT "CHK_memory_entries_name" CHECK (length(btrim("name")) > 0),
        CONSTRAINT "CHK_memory_entries_body" CHECK (length(btrim("body")) > 0),
        CONSTRAINT "CHK_memory_entries_content_hash" CHECK (
          "content_hash" ~ '^sha256:[0-9a-f]{64}$'
        ),
        CONSTRAINT "CHK_memory_entries_source_kind" CHECK (
          "source_kind" IN ('manual', 'confirmed_tool', 'import')
        ),
        CONSTRAINT "CHK_memory_entries_source" CHECK (
          ("source_kind" = 'manual'
            AND "source_execution_id" IS NULL
            AND "source_turn_id" IS NULL
            AND "source_message_id" IS NULL
            AND "source_artifact_id" IS NULL
            AND "source_artifact_revision" IS NULL)
          OR ("source_kind" = 'confirmed_tool'
            AND "source_execution_id" IS NOT NULL
            AND "source_turn_id" IS NOT NULL
            AND "source_artifact_id" IS NOT NULL)
          OR "source_kind" = 'import'
        ),
        CONSTRAINT "CHK_memory_entries_artifact_revision" CHECK (
          ("source_artifact_id" IS NULL AND "source_artifact_revision" IS NULL)
          OR ("source_artifact_id" IS NOT NULL
            AND ("source_artifact_revision" IS NULL OR "source_artifact_revision" >= 1))
        ),
        CONSTRAINT "CHK_memory_entries_consent" CHECK (
          "consent_status" = 'granted'
          AND "consent_basis" IN (
            'explicit_user_action', 'confirmed_tool_plan', 'imported_with_consent'
          )
        ),
        CONSTRAINT "CHK_memory_entries_consent_source" CHECK (
          ("source_kind" = 'manual' AND "consent_basis" = 'explicit_user_action')
          OR ("source_kind" = 'confirmed_tool' AND "consent_basis" = 'confirmed_tool_plan')
          OR ("source_kind" = 'import' AND "consent_basis" = 'imported_with_consent')
        ),
        CONSTRAINT "CHK_memory_entries_data_policy" CHECK (
          "data_classification" = 'workspace'
          AND "purpose" = 'conversation_memory'
          AND "allowed_destinations" <@ ARRAY['documents', 'documents-models']::text[]
          AND cardinality("allowed_destinations") > 0
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_memory_entries_assistant_updated"
      ON "memory_entries" ("assistant_id", "updated_at" DESC)
      WHERE "assistant_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_memory_entries_agent_updated"
      ON "memory_entries" ("agent_id", "updated_at" DESC)
      WHERE "agent_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_memory_entries_assistant_content"
      ON "memory_entries" ("assistant_id", "content_hash")
      WHERE "assistant_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_memory_entries_agent_content"
      ON "memory_entries" ("agent_id", "content_hash")
      WHERE "agent_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "memory_entries"`);
  }
}

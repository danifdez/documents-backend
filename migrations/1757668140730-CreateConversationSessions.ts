import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateConversationSessions1757668140730 implements MigrationInterface {
  name = 'CreateConversationSessions1757668140730';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "conversation_sessions" (
        "session_id" uuid NOT NULL,
        "owner_type" varchar(20) NOT NULL,
        "owner_id" integer NOT NULL,
        "conversation_artifact_id" uuid NOT NULL,
        "conversation_revision" integer NOT NULL DEFAULT 0,
        "active_turn_id" uuid,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_conversation_sessions" PRIMARY KEY ("session_id"),
        CONSTRAINT "CHK_conversation_sessions_owner_type"
          CHECK ("owner_type" IN ('assistant', 'agent')),
        CONSTRAINT "CHK_conversation_sessions_revision"
          CHECK ("conversation_revision" >= 0),
        CONSTRAINT "CHK_conversation_sessions_version" CHECK ("version" >= 1)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_conversation_sessions_owner"
      ON "conversation_sessions" ("owner_type", "owner_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "conversation_artifact_revisions" (
        "artifact_id" uuid NOT NULL,
        "revision" integer NOT NULL,
        "session_id" uuid NOT NULL,
        "parent_revision" integer,
        "content_hash" varchar(71) NOT NULL,
        "messages" jsonb NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_conversation_artifact_revisions"
          PRIMARY KEY ("artifact_id", "revision"),
        CONSTRAINT "FK_conversation_artifact_revisions_session"
          FOREIGN KEY ("session_id") REFERENCES "conversation_sessions"("session_id")
          ON DELETE CASCADE,
        CONSTRAINT "CHK_conversation_artifact_revisions_revision"
          CHECK ("revision" >= 1),
        CONSTRAINT "CHK_conversation_artifact_revisions_parent"
          CHECK (
            ("revision" = 1 AND "parent_revision" IS NULL)
            OR "parent_revision" = "revision" - 1
          ),
        CONSTRAINT "CHK_conversation_artifact_revisions_hash"
          CHECK ("content_hash" ~ '^sha256:[0-9a-f]{64}$'),
        CONSTRAINT "CHK_conversation_artifact_revisions_messages"
          CHECK (jsonb_typeof("messages") = 'array')
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_conversation_artifact_revisions_session_revision"
      ON "conversation_artifact_revisions" ("session_id", "revision")
    `);

    await queryRunner.query(`
      CREATE TABLE "conversation_turns" (
        "turn_id" uuid NOT NULL,
        "session_id" uuid NOT NULL,
        "root_execution_id" uuid NOT NULL,
        "request_artifact_id" uuid NOT NULL,
        "request_artifact_revision" integer NOT NULL DEFAULT 1,
        "starting_conversation_revision" integer NOT NULL,
        "terminal_conversation_revision" integer,
        "status" varchar(20) NOT NULL,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "finished_at" timestamptz,
        CONSTRAINT "PK_conversation_turns" PRIMARY KEY ("turn_id"),
        CONSTRAINT "UQ_conversation_turns_root_execution" UNIQUE ("root_execution_id"),
        CONSTRAINT "FK_conversation_turns_session"
          FOREIGN KEY ("session_id") REFERENCES "conversation_sessions"("session_id")
          ON DELETE CASCADE,
        CONSTRAINT "CHK_conversation_turns_status"
          CHECK ("status" IN ('queued', 'active', 'completed', 'failed', 'cancelled')),
        CONSTRAINT "CHK_conversation_turns_revisions"
          CHECK (
            "request_artifact_revision" >= 1
            AND "starting_conversation_revision" >= 1
            AND (
              "terminal_conversation_revision" IS NULL
              OR "terminal_conversation_revision" >= "starting_conversation_revision"
            )
          ),
        CONSTRAINT "CHK_conversation_turns_terminal"
          CHECK (
            ("status" IN ('queued', 'active')
              AND "terminal_conversation_revision" IS NULL
              AND "finished_at" IS NULL)
            OR ("status" IN ('completed', 'failed', 'cancelled')
              AND "terminal_conversation_revision" IS NOT NULL
              AND "finished_at" IS NOT NULL)
          ),
        CONSTRAINT "CHK_conversation_turns_version" CHECK ("version" >= 1)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_conversation_turns_session_status"
      ON "conversation_turns" ("session_id", "status", "created_at")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_conversation_turns_active_session"
      ON "conversation_turns" ("session_id") WHERE "status" = 'active'
    `);

    await queryRunner.query(`
      ALTER TABLE "executions"
      ADD CONSTRAINT "FK_executions_session"
      FOREIGN KEY ("session_id") REFERENCES "conversation_sessions"("session_id")
      ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      ALTER TABLE "executions"
      ADD CONSTRAINT "FK_executions_turn"
      FOREIGN KEY ("turn_id") REFERENCES "conversation_turns"("turn_id")
      ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
    `);
    await queryRunner.query(`
      ALTER TABLE "conversation_turns"
      ADD CONSTRAINT "FK_conversation_turns_root_execution"
      FOREIGN KEY ("root_execution_id") REFERENCES "executions"("execution_id")
      ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
    `);
    await queryRunner.query(`
      ALTER TABLE "conversation_turns"
      ADD CONSTRAINT "FK_conversation_turns_request_artifact"
      FOREIGN KEY ("request_artifact_id") REFERENCES "execution_artifacts"("artifact_id")
      ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
    `);
    await queryRunner.query(`
      ALTER TABLE "conversation_sessions"
      ADD CONSTRAINT "FK_conversation_sessions_active_turn"
      FOREIGN KEY ("active_turn_id") REFERENCES "conversation_turns"("turn_id")
      ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
    `);
    for (const table of ['assistant_messages', 'agent_messages']) {
      await queryRunner.query(`
        ALTER TABLE "${table}"
        ADD CONSTRAINT "FK_${table}_turn"
        FOREIGN KEY ("turn_id") REFERENCES "conversation_turns"("turn_id")
        ON DELETE CASCADE
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['agent_messages', 'assistant_messages']) {
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP CONSTRAINT "FK_${table}_turn"`,
      );
    }
    await queryRunner.query(
      `ALTER TABLE "conversation_sessions" DROP CONSTRAINT "FK_conversation_sessions_active_turn"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_turns" DROP CONSTRAINT "FK_conversation_turns_request_artifact"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_turns" DROP CONSTRAINT "FK_conversation_turns_root_execution"`,
    );
    await queryRunner.query(
      `ALTER TABLE "executions" DROP CONSTRAINT "FK_executions_turn"`,
    );
    await queryRunner.query(
      `ALTER TABLE "executions" DROP CONSTRAINT "FK_executions_session"`,
    );
    await queryRunner.query(`DROP TABLE "conversation_turns"`);
    await queryRunner.query(`DROP TABLE "conversation_artifact_revisions"`);
    await queryRunner.query(`DROP TABLE "conversation_sessions"`);
  }
}

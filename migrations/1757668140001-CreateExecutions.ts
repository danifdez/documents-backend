import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateExecutions1757668140001 implements MigrationInterface {
  name = 'CreateExecutions1757668140001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "executions" (
        "execution_id" uuid NOT NULL,
        "root_execution_id" uuid NOT NULL,
        "parent_execution_id" uuid,
        "turn_id" uuid,
        "owner_principal" varchar(200) NOT NULL,
        "schema_version" varchar(50) NOT NULL,
        "task_type" varchar(100) NOT NULL,
        "origin" varchar(30) NOT NULL DEFAULT 'root',
        "priority" varchar(20) NOT NULL DEFAULT 'normal',
        "payload" jsonb,
        "status" varchar(20) NOT NULL DEFAULT 'queued',
        "phase" varchar(80),
        "wait_reason" varchar(100),
        "completion_kind" varchar(20),
        "completion_reason" varchar(100),
        "result" jsonb,
        "error" jsonb,
        "checkpoint" jsonb,
        "completed_at" timestamptz,
        "last_sequence" bigint NOT NULL DEFAULT 0,
        "last_event_id" uuid,
        "completeness_status" varchar(30) NOT NULL DEFAULT 'reproducible',
        "missing_evidence" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_executions" PRIMARY KEY ("execution_id"),
        CONSTRAINT "FK_executions_parent" FOREIGN KEY ("parent_execution_id")
          REFERENCES "executions"("execution_id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_executions_owner" ON "executions" ("owner_principal")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_executions_root" ON "executions" ("root_execution_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_executions_parent" ON "executions" ("parent_execution_id")`,
    );
    await queryRunner.query(`
      CREATE TABLE "execution_events" (
        "event_id" uuid NOT NULL,
        "root_execution_id" uuid NOT NULL,
        "sequence" bigint NOT NULL,
        "producer_component" varchar(80) NOT NULL,
        "producer_instance_id" varchar(200) NOT NULL,
        "producer_sequence" bigint NOT NULL,
        "event_type" varchar(80) NOT NULL,
        "execution_id" uuid NOT NULL,
        "operation_id" uuid,
        "attempt_id" uuid,
        "caused_by_event_id" uuid,
        "occurred_at" timestamptz NOT NULL,
        "ingested_at" timestamptz NOT NULL DEFAULT now(),
        "content_hash" varchar(71) NOT NULL,
        "envelope" jsonb NOT NULL,
        CONSTRAINT "PK_execution_events" PRIMARY KEY ("event_id"),
        CONSTRAINT "FK_execution_events_root" FOREIGN KEY ("root_execution_id")
          REFERENCES "executions"("execution_id") ON DELETE CASCADE,
        CONSTRAINT "FK_execution_events_execution" FOREIGN KEY ("execution_id")
          REFERENCES "executions"("execution_id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_execution_events_sequence" ON "execution_events" ("root_execution_id", "sequence")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_execution_events_producer_sequence" ON "execution_events" ("root_execution_id", "producer_component", "producer_instance_id", "producer_sequence")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_execution_events_execution" ON "execution_events" ("root_execution_id", "execution_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_execution_events_operation" ON "execution_events" ("root_execution_id", "operation_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_execution_events_type" ON "execution_events" ("root_execution_id", "event_type")`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_execution_events_operation_start"
      ON "execution_events" ("root_execution_id", "operation_id", "attempt_id")
      WHERE "event_type" = 'operation.started'
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_execution_events_operation_finish"
      ON "execution_events" ("root_execution_id", "operation_id", "attempt_id")
      WHERE "event_type" = 'operation.finished'
    `);

    await queryRunner.query(`
      CREATE TABLE "execution_artifacts" (
        "artifact_id" uuid NOT NULL,
        "root_execution_id" uuid NOT NULL,
        "kind" varchar(80) NOT NULL,
        "content_hash" varchar(71) NOT NULL,
        "size" bigint NOT NULL,
        "media_type" varchar(200) NOT NULL,
        "encoding" varchar(20) NOT NULL DEFAULT 'identity',
        "data_classification" varchar(30) NOT NULL,
        "redaction" jsonb NOT NULL DEFAULT '{"applied":false}'::jsonb,
        "retention_class" varchar(30) NOT NULL,
        "created_by_event_id" uuid,
        "input_source_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "storage_ref" varchar(500) NOT NULL,
        "body" bytea,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_execution_artifacts" PRIMARY KEY ("artifact_id"),
        CONSTRAINT "FK_execution_artifacts_root" FOREIGN KEY ("root_execution_id")
          REFERENCES "executions"("execution_id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_execution_artifacts_hash" ON "execution_artifacts" ("root_execution_id", "content_hash")`,
    );
    await queryRunner.query(`
      CREATE FUNCTION reject_execution_event_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'execution events are append-only';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_execution_events_append_only"
      BEFORE UPDATE OR DELETE ON "execution_events"
      FOR EACH ROW EXECUTE FUNCTION reject_execution_event_mutation()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER "TR_execution_events_append_only" ON "execution_events"`,
    );
    await queryRunner.query(`DROP FUNCTION reject_execution_event_mutation()`);
    await queryRunner.query(`DROP TABLE "execution_artifacts"`);
    await queryRunner.query(`DROP TABLE "execution_events"`);
    await queryRunner.query(`DROP TABLE "executions"`);
  }
}

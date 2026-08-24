import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateExecutionOperations1757668140410 implements MigrationInterface {
  name = 'CreateExecutionOperations1757668140410';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "executions" execution
      WHERE execution."last_event_id" IS NULL
        AND EXISTS (
          SELECT 1
          FROM "execution_steps" step
          WHERE step."execution_id" = execution."execution_id"
        )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_execution_steps_operation_identity"
      ON "execution_steps" ("execution_id", "step_id", "operation_id")
    `);
    await queryRunner.query(`
      CREATE TABLE "execution_operations" (
        "operation_id" uuid NOT NULL,
        "execution_id" uuid NOT NULL,
        "step_id" uuid NOT NULL,
        "schema_version" varchar(50) NOT NULL,
        "operation_kind" varchar(30) NOT NULL,
        "status" varchar(30) NOT NULL,
        "recovery_class" varchar(30) NOT NULL,
        "current_attempt_id" uuid,
        "caused_by_event_id" uuid NOT NULL,
        "result" jsonb,
        "error" jsonb,
        "started_at" timestamptz NOT NULL,
        "finished_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_execution_operations" PRIMARY KEY ("operation_id"),
        CONSTRAINT "FK_execution_operations_execution" FOREIGN KEY ("execution_id")
          REFERENCES "executions"("execution_id") ON DELETE CASCADE,
        CONSTRAINT "FK_execution_operations_step_identity" FOREIGN KEY (
          "execution_id", "step_id", "operation_id"
        ) REFERENCES "execution_steps"(
          "execution_id", "step_id", "operation_id"
        ) ON DELETE CASCADE,
        CONSTRAINT "FK_execution_operations_caused_by_event" FOREIGN KEY ("caused_by_event_id")
          REFERENCES "execution_events"("event_id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_execution_operations_kind" CHECK (
          "operation_kind" IN (
            'inference', 'tool_call', 'http', 'context_build',
            'browser_observation', 'browser_action', 'verification',
            'artifact_processing'
          )
        ),
        CONSTRAINT "CHK_execution_operations_status" CHECK (
          "status" IN ('planned', 'prepared', 'dispatched', 'succeeded', 'failed', 'cancelled', 'unknown', 'not_executed')
        ),
        CONSTRAINT "CHK_execution_operations_recovery" CHECK (
          "recovery_class" IN ('read_only_replayable', 'idempotent', 'effect_checked', 'non_resumable')
        )
      )
    `);
    await queryRunner.query(`
      INSERT INTO "execution_operations" (
        "operation_id", "execution_id", "step_id", "schema_version",
        "operation_kind", "status", "recovery_class", "current_attempt_id",
        "caused_by_event_id", "result", "error", "started_at", "finished_at",
        "created_at", "updated_at"
      )
      SELECT
        step."operation_id",
        step."execution_id",
        step."step_id",
        'operation/1',
        CASE step."step_kind"
          WHEN 'inference' THEN 'inference'
          WHEN 'tool' THEN 'tool_call'
          WHEN 'service' THEN 'artifact_processing'
          WHEN 'code' THEN 'tool_call'
          WHEN 'verification' THEN 'verification'
        END,
        CASE step."status"
          WHEN 'blocked' THEN 'planned'
          WHEN 'ready' THEN 'prepared'
          WHEN 'running' THEN 'dispatched'
          WHEN 'result_received' THEN 'dispatched'
          WHEN 'completed' THEN 'succeeded'
          WHEN 'failed' THEN 'failed'
          WHEN 'cancelled' THEN 'cancelled'
        END,
        CASE
          WHEN step."step_kind" IN ('inference', 'service', 'verification')
            THEN 'read_only_replayable'
          ELSE 'non_resumable'
        END,
        step."current_attempt_id",
        execution."last_event_id",
        step."result",
        step."error",
        step."created_at",
        CASE WHEN step."status" IN ('completed', 'failed', 'cancelled')
          THEN step."updated_at" ELSE NULL END,
        step."created_at",
        step."updated_at"
      FROM "execution_steps" step
      INNER JOIN "executions" execution
        ON execution."execution_id" = step."execution_id"
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_execution_operations_step" ON "execution_operations" ("step_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_execution_operations_execution" ON "execution_operations" ("execution_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_execution_operations_status" ON "execution_operations" ("status", "updated_at")`,
    );
    await queryRunner.query(`
      ALTER TABLE "execution_operations"
      ADD CONSTRAINT "FK_execution_operations_current_attempt" FOREIGN KEY (
        "execution_id", "step_id", "operation_id", "current_attempt_id"
      ) REFERENCES "execution_step_attempts"(
        "execution_id", "step_id", "operation_id", "attempt_id"
      ) ON DELETE SET NULL ("current_attempt_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "execution_operations" DROP CONSTRAINT "FK_execution_operations_current_attempt"`,
    );
    await queryRunner.query(`DROP TABLE "execution_operations"`);
    await queryRunner.query(
      `DROP INDEX "UQ_execution_steps_operation_identity"`,
    );
  }
}

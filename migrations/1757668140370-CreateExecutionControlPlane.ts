import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateExecutionControlPlane1757668140370 implements MigrationInterface {
  name = 'CreateExecutionControlPlane1757668140370';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "execution_steps" (
        "step_id" uuid NOT NULL,
        "execution_id" uuid NOT NULL,
        "schema_version" varchar(50) NOT NULL,
        "step_kind" varchar(30) NOT NULL,
        "status" varchar(30) NOT NULL,
        "version" integer NOT NULL DEFAULT 1,
        "input_artifact_refs" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "work" jsonb NOT NULL,
        "required_capabilities" text[] NOT NULL DEFAULT '{}',
        "resource_keys" text[] NOT NULL DEFAULT '{}',
        "budget_reservation_id" uuid,
        "priority" integer NOT NULL DEFAULT 0,
        "available_at" timestamptz NOT NULL DEFAULT now(),
        "deadline" timestamptz,
        "operation_id" uuid NOT NULL,
        "current_attempt_id" uuid,
        "result" jsonb,
        "error" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_execution_steps" PRIMARY KEY ("step_id"),
        CONSTRAINT "FK_execution_steps_execution" FOREIGN KEY ("execution_id")
          REFERENCES "executions"("execution_id") ON DELETE CASCADE,
        CONSTRAINT "CHK_execution_steps_kind" CHECK (
          "step_kind" IN ('inference', 'tool', 'service', 'code', 'verification')
        ),
        CONSTRAINT "CHK_execution_steps_status" CHECK (
          "status" IN ('blocked', 'ready', 'running', 'result_received', 'completed', 'failed', 'cancelled')
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_execution_steps_execution" ON "execution_steps" ("execution_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_execution_steps_ready" ON "execution_steps" ("status", "priority", "available_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_execution_steps_current_attempt" ON "execution_steps" ("current_attempt_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "execution_step_dependencies" (
        "step_id" uuid NOT NULL,
        "depends_on_step_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_execution_step_dependencies" PRIMARY KEY ("step_id", "depends_on_step_id"),
        CONSTRAINT "FK_execution_step_dependencies_step" FOREIGN KEY ("step_id")
          REFERENCES "execution_steps"("step_id") ON DELETE CASCADE,
        CONSTRAINT "FK_execution_step_dependencies_depends_on" FOREIGN KEY ("depends_on_step_id")
          REFERENCES "execution_steps"("step_id") ON DELETE CASCADE,
        CONSTRAINT "CHK_execution_step_dependencies_not_self" CHECK ("step_id" <> "depends_on_step_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_execution_step_dependencies_depends_on" ON "execution_step_dependencies" ("depends_on_step_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "execution_step_attempts" (
        "attempt_id" uuid NOT NULL,
        "execution_id" uuid NOT NULL,
        "step_id" uuid NOT NULL,
        "operation_id" uuid NOT NULL,
        "schema_version" varchar(50) NOT NULL,
        "claimed_by" uuid NOT NULL,
        "status" varchar(30) NOT NULL,
        "lease_granted_at" timestamptz NOT NULL,
        "lease_expires_at" timestamptz NOT NULL,
        "heartbeat_at" timestamptz,
        "started_at" timestamptz,
        "finished_at" timestamptz,
        "finish_reason" varchar(100),
        "result_receipt_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_execution_step_attempts" PRIMARY KEY ("attempt_id"),
        CONSTRAINT "FK_execution_step_attempts_execution" FOREIGN KEY ("execution_id")
          REFERENCES "executions"("execution_id") ON DELETE CASCADE,
        CONSTRAINT "FK_execution_step_attempts_step" FOREIGN KEY ("step_id")
          REFERENCES "execution_steps"("step_id") ON DELETE CASCADE,
        CONSTRAINT "CHK_execution_step_attempts_status" CHECK (
          "status" IN ('leased', 'running', 'result_received', 'expired', 'cancelled', 'failed', 'closed')
        )
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_execution_step_attempts_identity" ON "execution_step_attempts" ("execution_id", "step_id", "operation_id", "attempt_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_execution_step_attempts_step_attempt" ON "execution_step_attempts" ("step_id", "attempt_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_execution_step_attempts_step" ON "execution_step_attempts" ("step_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_execution_step_attempts_lease" ON "execution_step_attempts" ("status", "lease_expires_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE "execution_result_receipts" (
        "receipt_id" uuid NOT NULL,
        "execution_id" uuid NOT NULL,
        "step_id" uuid NOT NULL,
        "operation_id" uuid NOT NULL,
        "attempt_id" uuid NOT NULL,
        "schema_version" varchar(50) NOT NULL,
        "result_hash" varchar(71) NOT NULL,
        "result" jsonb NOT NULL,
        "received_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_execution_result_receipts" PRIMARY KEY ("receipt_id"),
        CONSTRAINT "FK_execution_result_receipts_execution" FOREIGN KEY ("execution_id")
          REFERENCES "executions"("execution_id") ON DELETE CASCADE,
        CONSTRAINT "FK_execution_result_receipts_step" FOREIGN KEY ("step_id")
          REFERENCES "execution_steps"("step_id") ON DELETE CASCADE,
        CONSTRAINT "FK_execution_result_receipts_attempt_identity" FOREIGN KEY (
          "execution_id", "step_id", "operation_id", "attempt_id"
        ) REFERENCES "execution_step_attempts"(
          "execution_id", "step_id", "operation_id", "attempt_id"
        ) ON DELETE CASCADE,
        CONSTRAINT "CHK_execution_result_receipts_hash" CHECK (
          "result_hash" ~ '^sha256:[0-9a-f]{64}$'
        )
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_execution_result_receipts_attempt" ON "execution_result_receipts" ("attempt_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_execution_result_receipts_step" ON "execution_result_receipts" ("step_id", "received_at")`,
    );

    await queryRunner.query(`
      ALTER TABLE "execution_steps"
      ADD CONSTRAINT "FK_execution_steps_current_attempt" FOREIGN KEY ("step_id", "current_attempt_id")
      REFERENCES "execution_step_attempts"("step_id", "attempt_id")
      ON DELETE SET NULL ("current_attempt_id")
    `);
    await queryRunner.query(`
      ALTER TABLE "execution_step_attempts"
      ADD CONSTRAINT "FK_execution_step_attempts_result_receipt" FOREIGN KEY ("result_receipt_id")
      REFERENCES "execution_result_receipts"("receipt_id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "execution_step_attempts" DROP CONSTRAINT "FK_execution_step_attempts_result_receipt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "execution_steps" DROP CONSTRAINT "FK_execution_steps_current_attempt"`,
    );
    await queryRunner.query(`DROP TABLE "execution_result_receipts"`);
    await queryRunner.query(`DROP TABLE "execution_step_attempts"`);
    await queryRunner.query(`DROP TABLE "execution_step_dependencies"`);
    await queryRunner.query(`DROP TABLE "execution_steps"`);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateExecutionToolPlans1757668140420 implements MigrationInterface {
  name = 'CreateExecutionToolPlans1757668140420';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "execution_tool_invocations" (
        "tool_call_id" uuid NOT NULL,
        "execution_id" uuid NOT NULL,
        "caused_by_event_id" uuid NOT NULL,
        "schema_version" varchar(50) NOT NULL,
        "name" varchar(200) NOT NULL,
        "invocation" jsonb NOT NULL,
        "invocation_hash" varchar(71) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_execution_tool_invocations" PRIMARY KEY ("tool_call_id"),
        CONSTRAINT "FK_execution_tool_invocations_execution" FOREIGN KEY ("execution_id")
          REFERENCES "executions"("execution_id") ON DELETE CASCADE,
        CONSTRAINT "FK_execution_tool_invocations_cause" FOREIGN KEY ("caused_by_event_id")
          REFERENCES "execution_events"("event_id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_execution_tool_invocations_hash" CHECK (
          "invocation_hash" ~ '^sha256:[0-9a-f]{64}$'
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_execution_tool_invocations_execution"
      ON "execution_tool_invocations" ("execution_id", "created_at")
    `);

    await queryRunner.query(`
      CREATE TABLE "execution_tool_plans" (
        "operation_id" uuid NOT NULL,
        "execution_id" uuid NOT NULL,
        "tool_call_id" uuid NOT NULL,
        "step_id" uuid,
        "schema_version" varchar(50) NOT NULL,
        "tool_name" varchar(200) NOT NULL,
        "plan" jsonb NOT NULL,
        "plan_hash" varchar(71) NOT NULL,
        "materialized_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_execution_tool_plans" PRIMARY KEY ("operation_id"),
        CONSTRAINT "FK_execution_tool_plans_execution" FOREIGN KEY ("execution_id")
          REFERENCES "executions"("execution_id") ON DELETE CASCADE,
        CONSTRAINT "FK_execution_tool_plans_invocation" FOREIGN KEY ("tool_call_id")
          REFERENCES "execution_tool_invocations"("tool_call_id") ON DELETE CASCADE,
        CONSTRAINT "FK_execution_tool_plans_step" FOREIGN KEY ("step_id")
          REFERENCES "execution_steps"("step_id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_execution_tool_plans_hash" CHECK (
          "plan_hash" ~ '^sha256:[0-9a-f]{64}$'
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_execution_tool_plans_tool_call"
      ON "execution_tool_plans" ("tool_call_id")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_execution_tool_plans_step"
      ON "execution_tool_plans" ("step_id") WHERE "step_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_execution_tool_plans_execution"
      ON "execution_tool_plans" ("execution_id", "created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "execution_tool_plans"`);
    await queryRunner.query(`DROP TABLE "execution_tool_invocations"`);
  }
}

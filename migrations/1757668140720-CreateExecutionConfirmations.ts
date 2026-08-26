import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateExecutionConfirmations1757668140720 implements MigrationInterface {
  name = 'CreateExecutionConfirmations1757668140720';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "executions"
        ADD COLUMN "wait_reason" varchar(40),
        ADD COLUMN "wait_condition" jsonb,
        ADD COLUMN "resume_phase" varchar(80),
        ADD COLUMN "wait_expires_at" timestamptz
    `);
    await queryRunner.query(`
      ALTER TABLE "executions"
        ADD CONSTRAINT "CHK_executions_wait_state" CHECK (
          (
            "status" = 'waiting'
            AND "wait_reason" IS NOT NULL
            AND "wait_condition" IS NOT NULL
            AND "resume_phase" IS NOT NULL
          ) OR (
            "status" <> 'waiting'
            AND "wait_reason" IS NULL
            AND "wait_condition" IS NULL
            AND "resume_phase" IS NULL
            AND "wait_expires_at" IS NULL
          )
        )
    `);
    await queryRunner.query(`
      CREATE TABLE "execution_confirmations" (
        "confirmation_id" uuid NOT NULL,
        "execution_id" uuid NOT NULL,
        "operation_id" uuid NOT NULL,
        "owner_principal" varchar(200) NOT NULL,
        "plan_hash" varchar(71) NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'pending',
        "decided_by" varchar(200),
        "decided_at" timestamptz,
        "expires_at" timestamptz,
        "requested_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_execution_confirmations" PRIMARY KEY ("confirmation_id"),
        CONSTRAINT "FK_execution_confirmations_execution" FOREIGN KEY ("execution_id")
          REFERENCES "executions"("execution_id") ON DELETE CASCADE,
        CONSTRAINT "FK_execution_confirmations_plan" FOREIGN KEY ("operation_id")
          REFERENCES "execution_tool_plans"("operation_id") ON DELETE CASCADE,
        CONSTRAINT "CHK_execution_confirmations_hash" CHECK (
          "plan_hash" ~ '^sha256:[0-9a-f]{64}$'
        ),
        CONSTRAINT "CHK_execution_confirmations_status" CHECK (
          "status" IN ('pending', 'approved', 'denied', 'expired')
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_execution_confirmations_operation"
      ON "execution_confirmations" ("operation_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_execution_confirmations_owner_status"
      ON "execution_confirmations" ("owner_principal", "status", "created_at")
    `);
  }

  public async down(): Promise<void> {}
}

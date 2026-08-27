import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateExecutionEffectJournal1757668140760 implements MigrationInterface {
  name = 'CreateExecutionEffectJournal1757668140760';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "execution_effect_journal" (
        "journal_id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "execution_id" uuid NOT NULL,
        "effect_key" varchar(160) NOT NULL,
        "effect_type" varchar(80) NOT NULL,
        "resource_key" varchar(255) NOT NULL,
        "intent_hash" varchar(71) NOT NULL,
        "intent" jsonb NOT NULL,
        "preparation_observation" jsonb,
        "status" varchar(20) NOT NULL,
        "observation" jsonb,
        "last_observation" jsonb,
        "last_observed_at" timestamptz,
        "applied_at" timestamptz,
        "verified_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_execution_effect_journal" PRIMARY KEY ("journal_id"),
        CONSTRAINT "FK_execution_effect_journal_execution"
          FOREIGN KEY ("execution_id") REFERENCES "executions"("execution_id")
          ON DELETE CASCADE,
        CONSTRAINT "CHK_execution_effect_journal_hash"
          CHECK ("intent_hash" ~ '^sha256:[0-9a-f]{64}$'),
        CONSTRAINT "CHK_execution_effect_journal_status"
          CHECK ("status" IN ('prepared', 'verified', 'inconclusive')),
        CONSTRAINT "CHK_execution_effect_journal_intent"
          CHECK (jsonb_typeof("intent") = 'object'),
        CONSTRAINT "CHK_execution_effect_journal_preparation"
          CHECK (
            "preparation_observation" IS NULL
            OR jsonb_typeof("preparation_observation") = 'object'
          ),
        CONSTRAINT "CHK_execution_effect_journal_last_observation"
          CHECK (
            ("last_observation" IS NULL AND "last_observed_at" IS NULL)
            OR
            (jsonb_typeof("last_observation") = 'object'
              AND "last_observed_at" IS NOT NULL)
          ),
        CONSTRAINT "CHK_execution_effect_journal_observation"
          CHECK (
            ("status" = 'prepared' AND "observation" IS NULL
              AND "applied_at" IS NULL AND "verified_at" IS NULL)
            OR
            ("status" = 'verified' AND "observation" IS NOT NULL
              AND jsonb_typeof("observation") = 'object'
              AND "verified_at" IS NOT NULL)
            OR
            ("status" = 'inconclusive' AND "observation" IS NOT NULL
              AND jsonb_typeof("observation") = 'object'
              AND "applied_at" IS NULL AND "verified_at" IS NOT NULL)
          )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_execution_effect_journal_identity"
      ON "execution_effect_journal" ("execution_id", "effect_key")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_execution_effect_journal_execution"
      ON "execution_effect_journal" ("execution_id", "status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "execution_effect_journal"`);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSkillActivations1757668140750 implements MigrationInterface {
  name = 'CreateSkillActivations1757668140750';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "execution_skill_activations" (
        "activation_id" uuid NOT NULL,
        "execution_id" uuid NOT NULL,
        "schema_version" varchar(50) NOT NULL,
        "skill_id" varchar(100) NOT NULL,
        "skill_version" varchar(100) NOT NULL,
        "content_hash" varchar(71) NOT NULL,
        "activation_reason" varchar(50) NOT NULL,
        "input_bindings" jsonb NOT NULL,
        "phase" varchar(80) NOT NULL,
        "checkpoint" jsonb,
        "status" varchar(20) NOT NULL,
        "activated_at" timestamptz NOT NULL DEFAULT now(),
        "finished_at" timestamptz,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_execution_skill_activations" PRIMARY KEY ("activation_id"),
        CONSTRAINT "FK_execution_skill_activations_execution"
          FOREIGN KEY ("execution_id") REFERENCES "executions"("execution_id")
          ON DELETE CASCADE,
        CONSTRAINT "CHK_execution_skill_activations_schema"
          CHECK ("schema_version" = 'skill-activation/1'),
        CONSTRAINT "CHK_execution_skill_activations_hash"
          CHECK ("content_hash" ~ '^sha256:[0-9a-f]{64}$'),
        CONSTRAINT "CHK_execution_skill_activations_bindings"
          CHECK (jsonb_typeof("input_bindings") = 'object'),
        CONSTRAINT "CHK_execution_skill_activations_checkpoint"
          CHECK ("checkpoint" IS NULL OR jsonb_typeof("checkpoint") = 'object'),
        CONSTRAINT "CHK_execution_skill_activations_status"
          CHECK ("status" IN ('active', 'completed', 'failed', 'cancelled', 'superseded')),
        CONSTRAINT "CHK_execution_skill_activations_terminal"
          CHECK (
            ("status" = 'active' AND "finished_at" IS NULL)
            OR ("status" <> 'active' AND "finished_at" IS NOT NULL)
          )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_execution_skill_activations_identity"
      ON "execution_skill_activations" ("execution_id", "skill_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_execution_skill_activations_execution"
      ON "execution_skill_activations" ("execution_id", "status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "execution_skill_activations"`);
  }
}

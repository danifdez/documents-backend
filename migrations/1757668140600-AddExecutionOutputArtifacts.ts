import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExecutionOutputArtifacts1757668140600 implements MigrationInterface {
  name = 'AddExecutionOutputArtifacts1757668140600';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "execution_artifacts"
      ADD COLUMN "produced_by_attempt_id" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "execution_artifacts"
      ADD CONSTRAINT "FK_execution_artifacts_attempt"
      FOREIGN KEY ("produced_by_attempt_id")
      REFERENCES "execution_step_attempts"("attempt_id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_execution_artifacts_attempt"
      ON "execution_artifacts" ("produced_by_attempt_id")
    `);
    await queryRunner.query(`
      ALTER TABLE "execution_steps"
      ADD COLUMN "output_artifact_refs" jsonb NOT NULL DEFAULT '[]'::jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "execution_steps" DROP COLUMN "output_artifact_refs"
    `);
    await queryRunner.query(`DROP INDEX "IDX_execution_artifacts_attempt"`);
    await queryRunner.query(`
      ALTER TABLE "execution_artifacts"
      DROP CONSTRAINT "FK_execution_artifacts_attempt"
    `);
    await queryRunner.query(`
      ALTER TABLE "execution_artifacts" DROP COLUMN "produced_by_attempt_id"
    `);
  }
}

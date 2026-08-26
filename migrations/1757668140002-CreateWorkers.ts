import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWorkers1757668140002 implements MigrationInterface {
  name = 'CreateWorkers1757668140002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "workers" ("id" UUID NOT NULL DEFAULT gen_random_uuid(), "name" VARCHAR NOT NULL, "worker_kind" VARCHAR(20) NOT NULL DEFAULT 'models', "owner_principal" VARCHAR(255), "capabilities" JSONB NOT NULL DEFAULT '[]', "protocol_version" VARCHAR(50) NOT NULL DEFAULT 'step-protocol/1', "step_kinds" TEXT[] NOT NULL DEFAULT '{}', "maximum_concurrency" INTEGER NOT NULL DEFAULT 1, "status" VARCHAR NOT NULL DEFAULT 'online', "last_heartbeat" TIMESTAMP NOT NULL DEFAULT now(), "started_at" TIMESTAMP NOT NULL DEFAULT now(), "metadata" JSONB, "credential_hash" VARCHAR(71), "revoked_at" TIMESTAMPTZ, CONSTRAINT "PK_workers" PRIMARY KEY ("id"), CONSTRAINT "CHK_workers_maximum_concurrency" CHECK ("maximum_concurrency" BETWEEN 1 AND 64), CONSTRAINT "CHK_workers_kind" CHECK ("worker_kind" IN ('models', 'browser')), CONSTRAINT "CHK_workers_kind_scope" CHECK (("worker_kind" = 'models' AND "owner_principal" IS NULL AND NOT ('tool' = ANY("step_kinds"))) OR ("worker_kind" = 'browser' AND "owner_principal" IS NOT NULL AND "step_kinds" = ARRAY['tool']::text[] AND "maximum_concurrency" = 1)))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_workers_status" ON "workers" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_workers_browser_owner" ON "workers" ("owner_principal") WHERE "worker_kind" = 'browser' AND "revoked_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_workers_browser_owner"`);
    await queryRunner.query(`DROP INDEX "IDX_workers_status"`);
    await queryRunner.query(`DROP TABLE "workers"`);
  }
}

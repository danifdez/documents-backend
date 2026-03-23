import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWorkers1757668140002 implements MigrationInterface {
    name = 'CreateWorkers1757668140002'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "workers" ("id" UUID NOT NULL DEFAULT gen_random_uuid(), "name" VARCHAR NOT NULL, "capabilities" JSONB NOT NULL DEFAULT '[]', "status" VARCHAR NOT NULL DEFAULT 'online', "last_heartbeat" TIMESTAMP NOT NULL DEFAULT now(), "started_at" TIMESTAMP NOT NULL DEFAULT now(), "metadata" JSONB, CONSTRAINT "PK_workers" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_workers_status" ON "workers" ("status")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_workers_status"`);
        await queryRunner.query(`DROP TABLE "workers"`);
    }
}

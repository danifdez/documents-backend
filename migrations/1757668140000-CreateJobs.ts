import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateJobs1757668140095 implements MigrationInterface {
    name = 'CreateJobs1757668140095'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "jobs" ("id" SERIAL NOT NULL, "type" character varying NOT NULL, "priority" character varying DEFAULT 'normal', "payload" jsonb, "status" character varying NOT NULL DEFAULT 'pending', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "expires_at" TIMESTAMP, "result" jsonb, CONSTRAINT "PK_cf0a6c42b72fcc7f7c237def345" PRIMARY KEY ("id"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "jobs"`);
    }

}

import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateResourceDates1757668140030 implements MigrationInterface {
    name = 'CreateResourceDates1757668140030'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "resource_dates" ("id" SERIAL NOT NULL, "resource_id" integer NOT NULL, "date" date, "end_date" date, "raw_expression" character varying NOT NULL, "precision" character varying(8), "char_offset" integer, "context_snippet" text, "resolver" character varying(16) NOT NULL, "is_relative" boolean NOT NULL DEFAULT false, "unresolved_reason" character varying(32), "anchor_date_used" date, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_resource_dates" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_resource_dates_resource_id" ON "resource_dates" ("resource_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_resource_dates_resource_date" ON "resource_dates" ("resource_id", "date")`);
        await queryRunner.query(`ALTER TABLE "resource_dates" ADD CONSTRAINT "FK_resource_dates_resource" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "resource_dates" DROP CONSTRAINT "FK_resource_dates_resource"`);
        await queryRunner.query(`DROP INDEX "IDX_resource_dates_resource_date"`);
        await queryRunner.query(`DROP INDEX "IDX_resource_dates_resource_id"`);
        await queryRunner.query(`DROP TABLE "resource_dates"`);
    }
}

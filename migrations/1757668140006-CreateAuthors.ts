import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuthors1757668140006 implements MigrationInterface {
    name = 'CreateAuthors1757668140006'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "authors" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_authors_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_authors_name_lower" ON "authors" (LOWER("name"))`);
        await queryRunner.query(`CREATE INDEX "IDX_authors_name" ON "authors" ("name")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_authors_name"`);
        await queryRunner.query(`DROP INDEX "UQ_authors_name_lower"`);
        await queryRunner.query(`DROP TABLE "authors"`);
    }
}

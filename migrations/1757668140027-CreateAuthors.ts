import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuthors1757668140027 implements MigrationInterface {
    name = 'CreateAuthors1757668140027'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "authors" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_authors_name" UNIQUE ("name"), CONSTRAINT "PK_authors" PRIMARY KEY ("id"))`);

        await queryRunner.query(`CREATE TABLE "resource_authors" ("resource_id" integer NOT NULL, "author_id" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_resource_authors" PRIMARY KEY ("resource_id", "author_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_resource_authors_resource" ON "resource_authors" ("resource_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_resource_authors_author" ON "resource_authors" ("author_id")`);
        await queryRunner.query(`ALTER TABLE "resource_authors" ADD CONSTRAINT "FK_resource_authors_resource" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "resource_authors" ADD CONSTRAINT "FK_resource_authors_author" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "resource_authors" DROP CONSTRAINT "FK_resource_authors_author"`);
        await queryRunner.query(`ALTER TABLE "resource_authors" DROP CONSTRAINT "FK_resource_authors_resource"`);
        await queryRunner.query(`DROP INDEX "IDX_resource_authors_author"`);
        await queryRunner.query(`DROP INDEX "IDX_resource_authors_resource"`);
        await queryRunner.query(`DROP TABLE "resource_authors"`);
        await queryRunner.query(`DROP TABLE "authors"`);
    }
}

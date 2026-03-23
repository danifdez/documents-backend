import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateResourceAuthors1757668140023 implements MigrationInterface {
    name = 'CreateResourceAuthors1757668140023'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "resource_authors" ("resource_id" integer NOT NULL, "author_id" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_resource_authors" PRIMARY KEY ("resource_id", "author_id"))`);
        await queryRunner.query(`ALTER TABLE "resource_authors" ADD CONSTRAINT "FK_resource_authors_author_id" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "resource_authors" ADD CONSTRAINT "FK_resource_authors_resource_id" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`CREATE INDEX "IDX_resource_authors_resource_id" ON "resource_authors" ("resource_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_resource_authors_author_id" ON "resource_authors" ("author_id")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_resource_authors_author_id"`);
        await queryRunner.query(`DROP INDEX "IDX_resource_authors_resource_id"`);
        await queryRunner.query(`ALTER TABLE "resource_authors" DROP CONSTRAINT "FK_resource_authors_resource_id"`);
        await queryRunner.query(`ALTER TABLE "resource_authors" DROP CONSTRAINT "FK_resource_authors_author_id"`);
        await queryRunner.query(`DROP TABLE "resource_authors"`);
    }
}

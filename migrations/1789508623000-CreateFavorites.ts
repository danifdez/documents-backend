import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFavorites1789508623000 implements MigrationInterface {
    name = 'CreateFavorites1789508623000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "favorites" ("id" SERIAL NOT NULL, "url" character varying NOT NULL, "title" character varying NOT NULL DEFAULT '', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "projectId" integer NOT NULL, CONSTRAINT "PK_favorites" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_favorites_project_url" ON "favorites" ("projectId", "url")`);
        await queryRunner.query(`ALTER TABLE "favorites" ADD CONSTRAINT "FK_favorites_project" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "favorites" DROP CONSTRAINT "FK_favorites_project"`);
        await queryRunner.query(`DROP INDEX "UQ_favorites_project_url"`);
        await queryRunner.query(`DROP TABLE "favorites"`);
    }
}

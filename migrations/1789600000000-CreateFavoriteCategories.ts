import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFavoriteCategories1789600000000 implements MigrationInterface {
  name = 'CreateFavoriteCategories1789600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "favorite_categories" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "projectId" integer NOT NULL, "parentId" integer, CONSTRAINT "PK_favorite_categories" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`ALTER TABLE "favorites" ADD "categoryId" integer`);
    await queryRunner.query(
      `CREATE INDEX "IDX_favorite_categories_project" ON "favorite_categories" ("projectId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "favorite_categories" ADD CONSTRAINT "FK_favorite_categories_project" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "favorite_categories" ADD CONSTRAINT "FK_favorite_categories_parent" FOREIGN KEY ("parentId") REFERENCES "favorite_categories"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "favorites" ADD CONSTRAINT "FK_favorites_category" FOREIGN KEY ("categoryId") REFERENCES "favorite_categories"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "favorites" DROP CONSTRAINT "FK_favorites_category"`,
    );
    await queryRunner.query(
      `ALTER TABLE "favorite_categories" DROP CONSTRAINT "FK_favorite_categories_parent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "favorite_categories" DROP CONSTRAINT "FK_favorite_categories_project"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_favorite_categories_project"`);
    await queryRunner.query(`ALTER TABLE "favorites" DROP COLUMN "categoryId"`);
    await queryRunner.query(`DROP TABLE "favorite_categories"`);
  }
}

import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateComments1757668140092 implements MigrationInterface {
    name = 'CreateComments1757668140092'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "comments" ("id" SERIAL NOT NULL, "content" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "docId" integer, CONSTRAINT "PK_8bf68bc960f2b69e818bdb90dcb" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "comments" ADD CONSTRAINT "FK_fb5e23139ad2d6505ed4e2cf4cd" FOREIGN KEY ("docId") REFERENCES "docs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "comments" DROP CONSTRAINT "FK_fb5e23139ad2d6505ed4e2cf4cd"`);
        await queryRunner.query(`DROP TABLE "comments"`);
    }

}

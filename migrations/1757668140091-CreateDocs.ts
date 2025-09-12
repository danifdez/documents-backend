import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateDocs1757668140091 implements MigrationInterface {
    name = 'CreateDocs1757668140091'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "docs" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, "content" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "threadId" integer, "projectId" integer, CONSTRAINT "PK_3a13e0daf5db0055b25d829f2f2" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "docs" ADD CONSTRAINT "FK_cbc025d41513470298f5f21c6cc" FOREIGN KEY ("threadId") REFERENCES "threads"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "docs" ADD CONSTRAINT "FK_e6ed7ec924e33ed1323d9c6c8fe" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "docs" DROP CONSTRAINT "FK_e6ed7ec924e33ed1323d9c6c8fe"`);
        await queryRunner.query(`ALTER TABLE "docs" DROP CONSTRAINT "FK_cbc025d41513470298f5f21c6cc"`);
        await queryRunner.query(`DROP TABLE "docs"`);
    }

}

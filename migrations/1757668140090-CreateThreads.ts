import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateThreads1757668140090 implements MigrationInterface {
    name = 'CreateThreads1757668140090'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "threads" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, "description" text, "parent" integer, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "projectId" integer, CONSTRAINT "PK_d8a74804c34fc3900502cd27275" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "threads" ADD CONSTRAINT "FK_3acbab3c91ef7c75eb0709f44f7" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "threads" DROP CONSTRAINT "FK_3acbab3c91ef7c75eb0709f44f7"`);
        await queryRunner.query(`DROP TABLE "threads"`);
    }

}

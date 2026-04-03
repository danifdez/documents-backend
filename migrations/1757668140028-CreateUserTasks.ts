import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUserTasks1757668140028 implements MigrationInterface {
    name = 'CreateUserTasks1757668140028'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "user_tasks" ("id" SERIAL NOT NULL, "title" character varying NOT NULL, "description" text, "status" character varying NOT NULL DEFAULT 'pending', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "projectId" integer, CONSTRAINT "PK_user_tasks" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "user_tasks" ADD CONSTRAINT "FK_user_tasks_project" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_tasks" DROP CONSTRAINT "FK_user_tasks_project"`);
        await queryRunner.query(`DROP TABLE "user_tasks"`);
    }
}

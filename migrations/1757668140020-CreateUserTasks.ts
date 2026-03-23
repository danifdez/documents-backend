import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUserTasks1757668140020 implements MigrationInterface {
    name = 'CreateUserTasks1757668140020'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "user_tasks" ("id" SERIAL PRIMARY KEY, "title" VARCHAR NOT NULL, "description" TEXT, "status" VARCHAR NOT NULL DEFAULT 'pending', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "projectId" INTEGER REFERENCES "projects"("id") ON DELETE SET NULL)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "user_tasks"`);
    }
}

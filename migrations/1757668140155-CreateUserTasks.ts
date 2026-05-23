import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUserTasks1757668140155 implements MigrationInterface {
  name = 'CreateUserTasks1757668140155';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "user_tasks" (
        "id" SERIAL PRIMARY KEY,
        "title" VARCHAR NOT NULL,
        "description" TEXT,
        "status" VARCHAR DEFAULT 'pending',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "projectId" INTEGER,
        CONSTRAINT "FK_user_tasks_project"
          FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "user_tasks"`);
  }
}

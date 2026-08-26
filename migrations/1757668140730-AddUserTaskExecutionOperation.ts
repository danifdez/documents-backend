import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserTaskExecutionOperation1757668140730 implements MigrationInterface {
  name = 'AddUserTaskExecutionOperation1757668140730';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_tasks"
        ADD COLUMN "execution_operation_id" uuid
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_user_tasks_execution_operation"
      ON "user_tasks" ("execution_operation_id")
      WHERE "execution_operation_id" IS NOT NULL
    `);
  }

  public async down(): Promise<void> {}
}

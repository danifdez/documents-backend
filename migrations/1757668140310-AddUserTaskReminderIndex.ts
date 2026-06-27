import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserTaskReminderIndex1757668140310 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Partial index: scheduler only scans rows with reminder_at != NULL.
    await queryRunner.query(`CREATE INDEX "idx_user_tasks_reminder_at" ON "user_tasks" ("reminder_at") WHERE "reminder_at" IS NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_user_tasks_reminder_at"`);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserTaskReminder1757668140160 implements MigrationInterface {
  name = 'AddUserTaskReminder1757668140160';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_tasks" ADD COLUMN "reminder_at" TIMESTAMPTZ`,
    );
    // Partial index: scheduler only scans rows with reminder_at != NULL.
    await queryRunner.query(
      `CREATE INDEX "idx_user_tasks_reminder_at"
       ON "user_tasks" ("reminder_at")
       WHERE "reminder_at" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_user_tasks_reminder_at"`);
    await queryRunner.query(`ALTER TABLE "user_tasks" DROP COLUMN "reminder_at"`);
  }
}

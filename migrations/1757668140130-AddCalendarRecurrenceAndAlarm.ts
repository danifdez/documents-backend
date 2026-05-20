import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCalendarRecurrenceAndAlarm1757668140130 implements MigrationInterface {
    name = 'AddCalendarRecurrenceAndAlarm1757668140130'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "calendar_events" ADD COLUMN "recurrence_rule" text`,
        );
        await queryRunner.query(
            `ALTER TABLE "calendar_events" ADD COLUMN "alarm" jsonb`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "calendar_events" DROP COLUMN "alarm"`,
        );
        await queryRunner.query(
            `ALTER TABLE "calendar_events" DROP COLUMN "recurrence_rule"`,
        );
    }
}

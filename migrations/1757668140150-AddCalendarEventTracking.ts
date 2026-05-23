import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCalendarEventTracking1757668140150 implements MigrationInterface {
  name = 'AddCalendarEventTracking1757668140150';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "calendar_events" ADD COLUMN "track_completion" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(`
      CREATE TABLE "event_occurrence_completion" (
        "id" SERIAL PRIMARY KEY,
        "event_id" integer NOT NULL REFERENCES "calendar_events"("id") ON DELETE CASCADE,
        "occurrence_date" TIMESTAMPTZ NOT NULL,
        "completed_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_event_occurrence" ON "event_occurrence_completion" ("event_id", "occurrence_date")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "uq_event_occurrence"`);
    await queryRunner.query(`DROP TABLE "event_occurrence_completion"`);
    await queryRunner.query(`ALTER TABLE "calendar_events" DROP COLUMN "track_completion"`);
  }
}

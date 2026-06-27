import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEventOccurrenceCompletion1757668140300 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "event_occurrence_completion" ("id" SERIAL NOT NULL, "event_id" integer NOT NULL, "occurrence_date" TIMESTAMP WITH TIME ZONE NOT NULL, "completed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_event_occurrence_completion" PRIMARY KEY ("id"))`);
    await queryRunner.query(`ALTER TABLE "event_occurrence_completion" ADD CONSTRAINT "FK_event_occurrence_completion_event" FOREIGN KEY ("event_id") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_event_occurrence" ON "event_occurrence_completion" ("event_id", "occurrence_date")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "event_occurrence_completion"`);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCalendarEvents1757668140017 implements MigrationInterface {
    name = 'CreateCalendarEvents1757668140017'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "calendar_events" ("id" SERIAL NOT NULL, "title" character varying NOT NULL, "description" text, "start_date" TIMESTAMP WITH TIME ZONE NOT NULL, "end_date" TIMESTAMP WITH TIME ZONE, "color" character varying DEFAULT '#3b82f6', "all_day" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "projectId" integer, CONSTRAINT "PK_calendar_events" PRIMARY KEY ("id"), CONSTRAINT "FK_calendar_events_project" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "calendar_events"`);
    }
}

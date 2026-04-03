import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTimelines1757668140024 implements MigrationInterface {
    name = 'CreateTimelines1757668140024'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "timelines" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, "timeline_data" jsonb, "epochs" jsonb, "notes" text, "sync_dataset_id" integer, "sync_mapping" jsonb, "layout_type" character varying NOT NULL DEFAULT 'horizontal', "axis_breaks" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "projectId" integer, CONSTRAINT "PK_timelines" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "timelines" ADD CONSTRAINT "FK_timelines_project" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "timelines" DROP CONSTRAINT "FK_timelines_project"`);
        await queryRunner.query(`DROP TABLE "timelines"`);
    }
}

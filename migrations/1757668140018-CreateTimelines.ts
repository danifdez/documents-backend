import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTimelines1757668140018 implements MigrationInterface {
    name = 'CreateTimelines1757668140018'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "timelines" ("id" SERIAL PRIMARY KEY, "name" VARCHAR NOT NULL, "timeline_data" JSONB, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "projectId" INTEGER REFERENCES "projects"("id") ON DELETE SET NULL)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "timelines"`);
    }
}

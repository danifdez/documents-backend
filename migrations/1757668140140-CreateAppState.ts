import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAppState1757668140140 implements MigrationInterface {
    name = 'CreateAppState1757668140140'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "app_state" (
                "key" character varying(100) PRIMARY KEY,
                "value" text,
                "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "app_state"`);
    }
}

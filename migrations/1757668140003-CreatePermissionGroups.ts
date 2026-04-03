import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePermissionGroups1757668140003 implements MigrationInterface {
    name = 'CreatePermissionGroups1757668140003'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "permission_groups" ("id" SERIAL PRIMARY KEY, "name" VARCHAR(100) NOT NULL UNIQUE, "description" VARCHAR(500), "permissions" JSONB NOT NULL DEFAULT '{}', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now())`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "permission_groups"`);
    }
}

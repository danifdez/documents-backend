import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsers1757668140003 implements MigrationInterface {
    name = 'CreateUsers1757668140003'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "users" ("id" SERIAL PRIMARY KEY, "username" VARCHAR(100) NOT NULL UNIQUE, "password_hash" VARCHAR(255) NOT NULL, "display_name" VARCHAR(200), "role" VARCHAR(20) NOT NULL DEFAULT 'user', "permissions" JSONB NOT NULL DEFAULT '{}', "active" BOOLEAN NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now())`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_users_username" ON "users" ("username")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_users_username"`);
        await queryRunner.query(`DROP TABLE "users"`);
    }
}

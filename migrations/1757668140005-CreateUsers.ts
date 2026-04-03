import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsers1757668140005 implements MigrationInterface {
    name = 'CreateUsers1757668140005'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "users" ("id" SERIAL PRIMARY KEY, "username" VARCHAR(100) NOT NULL UNIQUE, "password_hash" VARCHAR(255) NOT NULL, "display_name" VARCHAR(200), "permissions" JSONB NOT NULL DEFAULT '{}', "group_id" INTEGER, "active" BOOLEAN NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now())`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_users_username" ON "users" ("username")`);
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "FK_users_group" FOREIGN KEY ("group_id") REFERENCES "permission_groups"("id") ON DELETE SET NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_users_group"`);
        await queryRunner.query(`DROP INDEX "IDX_users_username"`);
        await queryRunner.query(`DROP TABLE "users"`);
    }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserAvatarPath1757668140020 implements MigrationInterface {
    name = 'AddUserAvatarPath1757668140020'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "avatar_path" VARCHAR(500)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "avatar_path"`);
    }
}

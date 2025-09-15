import { MigrationInterface, QueryRunner } from "typeorm";

export class DropKeyPointsColumn1757668140095 implements MigrationInterface {
    name = 'DropKeyPointsColumn1757668140095'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "resources" DROP COLUMN "key_points"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "resources" ADD "key_points" jsonb`);
    }

}
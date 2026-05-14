import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddJobBlobColumns1757668140060 implements MigrationInterface {
    name = 'AddJobBlobColumns1757668140060'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "jobs" ADD COLUMN "input_blob" bytea`);
        await queryRunner.query(`ALTER TABLE "jobs" ADD COLUMN "result_blob" bytea`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "jobs" DROP COLUMN "result_blob"`);
        await queryRunner.query(`ALTER TABLE "jobs" DROP COLUMN "input_blob"`);
    }
}

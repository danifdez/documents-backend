import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEventToAssistantMessages1757668140090 implements MigrationInterface {
    name = 'AddEventToAssistantMessages1757668140090'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "assistant_messages" ADD COLUMN "event" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "assistant_messages" DROP COLUMN "event"`);
    }
}
